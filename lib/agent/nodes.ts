/**
 * nodes.ts
 *
 * Pipeline: 4 LLM calls (resolver → financials+news → moat+risk → decision)
 * - Each call has a 180s timeout (needed for the 550B free-tier model)
 * - No silent fallbacks for core research — if AI can't respond, we fail clearly
 * - All external data fetches (Alpha Vantage, Tavily) run in parallel
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { searchWeb, getCompanyOverview, getStockQuote } from "./tools";
import type {
  AgentState,
  AgentStep,
  CompanyInfo,
  FinancialMetrics,
  NewsAnalysis,
  MoatAnalysis,
  RiskAssessment,
  InvestmentDecision,
} from "./state";

// ─── LLM ──────────────────────────────────────────────────────────────────────

const MODEL = process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free";

const llm = new ChatOpenAI({
  model: MODEL,
  apiKey: process.env.OPENROUTER_API_KEY!,
  temperature: 0.1,
  maxRetries: 0,
  timeout: 180_000,   // 3-minute LangChain-level timeout for large models
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "NexusAI",
    },
  },
});

// ─── Core helper ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Call the LLM with:
 *  - A hard 180s wall-clock abort (separate from LangChain's own timeout)
 *  - A visible heartbeat every 25s
 *  - 429 retry: waits `delayMs` then retries up to `retries` times
 */
async function llmCall(
  messages: (SystemMessage | HumanMessage)[],
  opts: {
    onHeartbeat?: () => void;
    onRateLimit?: (waitSec: number) => void;
    retries?: number;
    delayMs?: number;
  } = {}
): Promise<string> {
  const { onHeartbeat, onRateLimit, retries = 2, delayMs = 45_000 } = opts;
  const TIMEOUT = 180_000;

  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(), TIMEOUT);

  let hb: ReturnType<typeof setInterval> | null = null;
  if (onHeartbeat) hb = setInterval(onHeartbeat, 25_000);

  try {
    const res = await Promise.race([
      llm.invoke(messages),
      new Promise<never>((_, rej) =>
        abort.signal.addEventListener("abort", () =>
          rej(new Error("LLM_TIMEOUT: model did not respond in 180 s"))
        )
      ),
    ]);
    return res.content as string;
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("LLM_TIMEOUT")) throw err;

    const is429 =
      msg.includes("429") || msg.includes("RateLimit") ||
      msg.includes("rate_limit") || msg.includes("capacity") ||
      msg.includes("MODEL_RATE_LIMIT");

    if (is429 && retries > 0) {
      const waitSec = Math.round(delayMs / 1000);
      onRateLimit?.(waitSec);
      await sleep(delayMs);
      return llmCall(messages, {
        onHeartbeat, onRateLimit,
        retries: retries - 1,
        delayMs: Math.min(delayMs + 30_000, 120_000),
      });
    }
    throw err;
  } finally {
    clearTimeout(abortTimer);
    if (hb) clearInterval(hb);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(text: string): any {
  try {
    const cleaned = text
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

function s(
  node: string,
  status: "running" | "complete" | "error",
  message: string,
  data?: Record<string, unknown>
): AgentStep {
  return { node, status, message, timestamp: Date.now(), data };
}

// ─── NODE 1: Company Resolver ─────────────────────────────────────────────────

export async function companyResolverNode(
  state: AgentState,
  emit: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  emit(s("companyResolver", "running", `Identifying "${state.companyQuery}"…`));

  try {
    const search = await searchWeb.invoke({
      query: `${state.companyQuery} stock ticker symbol exchange`,
      maxResults: 3,
    });

    const raw = await llmCall(
      [
        new SystemMessage(
          "Return ONLY a JSON object, no markdown:\n" +
          '{"name":"","ticker":"","sector":"","industry":"","description":"1 sentence max","marketCap":"","headquarters":"","exchange":""}'
        ),
        new HumanMessage(`"${state.companyQuery}"\n${search.slice(0, 1200)}`),
      ],
      {
        onHeartbeat: () => emit(s("companyResolver", "running", "Model is working…")),
        onRateLimit: (sec) => emit(s("companyResolver", "running", `Rate limited — retrying in ${sec}s…`)),
      }
    );

    const companyInfo = parseJson(raw) as CompanyInfo | null;
    if (!companyInfo?.ticker) {
      throw new Error(`Could not identify "${state.companyQuery}". Try using the ticker directly, e.g. AAPL.`);
    }

    emit(s("companyResolver", "complete",
      `✓ ${companyInfo.name} (${companyInfo.ticker}) · ${companyInfo.exchange}`,
      { company: companyInfo }
    ));
    return { companyInfo };
  } catch (err) {
    const msg = String(err);
    emit(s("companyResolver", "error",
      msg.includes("LLM_TIMEOUT")
        ? "Model timed out. The AI is overloaded — please try again."
        : `Failed: ${msg}`
    ));
    throw err;
  }
}

// ─── NODE 2: Financials + News ────────────────────────────────────────────────

export async function financialNewsNode(
  state: AgentState,
  emit: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  const co = state.companyInfo!;
  emit(s("financialAnalyst", "running", `Fetching financial data for ${co.ticker}…`));
  emit(s("newsAnalyst", "running", `Scanning news for ${co.name}…`));

  // External data fetches run in parallel
  const [overview, quote, news] = await Promise.allSettled([
    getCompanyOverview.invoke({ ticker: co.ticker }),
    getStockQuote.invoke({ ticker: co.ticker }),
    searchWeb.invoke({
      query: `${co.name} ${co.ticker} earnings revenue news analyst 2025`,
      maxResults: 4,
    }),
  ]);

  const financialRaw = [
    overview.status === "fulfilled" ? overview.value : "",
    quote.status    === "fulfilled" ? quote.value    : "",
  ].join("\n").slice(0, 2200);

  const newsRaw = (news.status === "fulfilled" ? news.value : "").slice(0, 1400);

  emit(s("financialAnalyst", "running", "AI analysing financials and news…"));
  emit(s("newsAnalyst",      "running", "AI scoring sentiment…"));

  const SYSTEM = `You are a senior equity analyst. Based on the data provided, return ONLY this JSON object with no markdown, no explanation, just pure JSON:
{
  "financials": {
    "currentPrice": null,
    "peRatio": null,
    "pbRatio": null,
    "revenueGrowth": null,
    "grossMargin": null,
    "netMargin": null,
    "roe": null,
    "debtToEquity": null,
    "freeCashFlow": null,
    "fiftyTwoWeekHigh": null,
    "fiftyTwoWeekLow": null,
    "analystTargetPrice": null,
    "eps": null
  },
  "news": {
    "overallSentiment": "neutral",
    "sentimentScore": 0.0,
    "recentNews": [
      {"title": "example headline", "summary": "brief summary", "sentiment": "neutral", "date": "2025"}
    ],
    "keyThemes": ["theme1"],
    "catalysts": ["catalyst1"],
    "concerns": ["concern1"]
  }
}
Fill ALL fields using the data. sentimentScore: float -1.0 (very negative) to 1.0 (very positive). Max 3 recentNews items.`;

  let raw = "";
  try {
    raw = await llmCall(
      [
        new SystemMessage(SYSTEM),
        new HumanMessage(
          `Company: ${co.name} (${co.ticker}) | ${co.sector}\n\nFINANCIAL DATA:\n${financialRaw}\n\nNEWS:\n${newsRaw}\n\nReturn the JSON:`
        ),
      ],
      {
        onHeartbeat: () => {
          emit(s("financialAnalyst", "running", "Model still generating financials…"));
          emit(s("newsAnalyst",      "running", "Model still generating news analysis…"));
        },
        onRateLimit: (sec) => {
          emit(s("financialAnalyst", "running", `Rate limited — retrying in ${sec}s…`));
          emit(s("newsAnalyst",      "running", `Rate limited — retrying in ${sec}s…`));
        },
      }
    );
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    const label = isTimeout
      ? "Model timed out — please retry the research"
      : `Error: ${msg}`;
    emit(s("financialAnalyst", "error", label));
    emit(s("newsAnalyst",      "error", label));
    throw new Error(`Financial/news analysis failed: ${isTimeout ? "model timed out" : msg}`);
  }

  const parsed = parseJson(raw);
  if (!parsed?.financials && !parsed?.news) {
    emit(s("financialAnalyst", "error", "AI returned invalid data — please retry"));
    emit(s("newsAnalyst",      "error", "AI returned invalid data — please retry"));
    throw new Error("AI returned unparseable response for financials/news. Please retry.");
  }

  const financialMetrics: FinancialMetrics = parsed.financials ?? {};
  const newsAnalysis: NewsAnalysis = {
    overallSentiment: parsed.news?.overallSentiment ?? "neutral",
    sentimentScore:   parsed.news?.sentimentScore   ?? 0,
    recentNews:       parsed.news?.recentNews       ?? [],
    keyThemes:        parsed.news?.keyThemes        ?? [],
    catalysts:        parsed.news?.catalysts        ?? [],
    concerns:         parsed.news?.concerns         ?? [],
  };

  emit(s("financialAnalyst", "complete",
    `P/E: ${financialMetrics.peRatio ?? "N/A"} · Net Margin: ${financialMetrics.netMargin ?? "N/A"}`,
    { metrics: financialMetrics }
  ));
  emit(s("newsAnalyst", "complete",
    `Sentiment: ${String(newsAnalysis.overallSentiment).toUpperCase()} (score: ${Number(newsAnalysis.sentimentScore).toFixed(2)})`,
    { sentiment: newsAnalysis.overallSentiment }
  ));

  return { financialMetrics, newsAnalysis, rawFinancialData: financialRaw, rawNewsData: newsRaw };
}

// ─── NODE 3: Moat + Risk ─────────────────────────────────────────────────────

export async function moatRiskNode(
  state: AgentState,
  emit: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  const co = state.companyInfo!;
  emit(s("moatAnalyzer", "running", `Researching competitive moat for ${co.name}…`));
  emit(s("riskAssessor", "running", "Evaluating investment risks…"));

  const moatSearch = await searchWeb.invoke({
    query: `${co.name} competitive advantage moat market share vs competitors 2025`,
    maxResults: 4,
  }).catch(() => "");

  emit(s("moatAnalyzer", "running", "AI scoring moat and risks…"));
  emit(s("riskAssessor", "running", "AI scoring moat and risks…"));

  const SYSTEM = `You are a Morningstar-style moat analyst and risk manager. Based on the data, return ONLY this JSON with no markdown:
{
  "moat": {
    "moatScore": 60,
    "moatType": ["switching costs"],
    "competitiveAdvantages": ["advantage1", "advantage2"],
    "marketPosition": "describe market position",
    "competitorComparison": "how it compares to competitors",
    "switchingCosts": "describe switching costs",
    "brandStrength": "describe brand strength",
    "networkEffects": "describe network effects",
    "costAdvantages": "describe cost advantages"
  },
  "risk": {
    "overallRiskLevel": "medium",
    "riskScore": 45,
    "keyRisks": ["risk1", "risk2", "risk3"],
    "redFlags": ["flag1"],
    "regulatoryRisks": "describe regulatory risks",
    "competitiveRisks": "describe competitive risks",
    "macroRisks": "describe macro risks",
    "financialRisks": "describe financial risks"
  }
}
moatScore: 0-100 (higher = stronger moat). moatType options: network effects, cost advantage, switching costs, intangible assets, efficient scale, none.
overallRiskLevel: low | medium | high | very-high. riskScore: 0-100 (higher = riskier).`;

  let raw = "";
  try {
    raw = await llmCall(
      [
        new SystemMessage(SYSTEM),
        new HumanMessage(
          `Company: ${co.name} (${co.ticker}) | ${co.sector} / ${co.industry}\n\n` +
          `Financials snapshot: P/E=${state.financialMetrics?.peRatio ?? "N/A"}, ` +
          `netMargin=${state.financialMetrics?.netMargin ?? "N/A"}, ` +
          `debtToEquity=${state.financialMetrics?.debtToEquity ?? "N/A"}\n` +
          `News sentiment: ${state.newsAnalysis?.overallSentiment ?? "N/A"} ` +
          `(score=${state.newsAnalysis?.sentimentScore ?? 0})\n` +
          `Concerns: ${JSON.stringify(state.newsAnalysis?.concerns ?? [])}\n\n` +
          `COMPETITIVE RESEARCH:\n${moatSearch.slice(0, 1800)}\n\nReturn the JSON:`
        ),
      ],
      {
        onHeartbeat: () => {
          emit(s("moatAnalyzer", "running", "Model still analysing moat…"));
          emit(s("riskAssessor", "running", "Model still assessing risks…"));
        },
        onRateLimit: (sec) => {
          emit(s("moatAnalyzer", "running", `Rate limited — retrying in ${sec}s…`));
          emit(s("riskAssessor", "running", `Rate limited — retrying in ${sec}s…`));
        },
      }
    );
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    const label = isTimeout ? "Model timed out — please retry" : `Error: ${msg}`;
    emit(s("moatAnalyzer", "error", label));
    emit(s("riskAssessor", "error", label));
    throw new Error(`Moat/risk analysis failed: ${isTimeout ? "model timed out" : msg}`);
  }

  const parsed = parseJson(raw);
  if (!parsed?.moat && !parsed?.risk) {
    emit(s("moatAnalyzer", "error", "AI returned invalid data — please retry"));
    emit(s("riskAssessor", "error", "AI returned invalid data — please retry"));
    throw new Error("AI returned unparseable response for moat/risk. Please retry.");
  }

  const moatAnalysis: MoatAnalysis = {
    moatScore:            parsed.moat?.moatScore            ?? 50,
    moatType:             parsed.moat?.moatType             ?? [],
    competitiveAdvantages: parsed.moat?.competitiveAdvantages ?? [],
    marketPosition:       parsed.moat?.marketPosition       ?? "",
    competitorComparison: parsed.moat?.competitorComparison ?? "",
    switchingCosts:       parsed.moat?.switchingCosts       ?? "",
    brandStrength:        parsed.moat?.brandStrength        ?? "",
    networkEffects:       parsed.moat?.networkEffects       ?? "",
    costAdvantages:       parsed.moat?.costAdvantages       ?? "",
  };

  const riskAssessment: RiskAssessment = {
    overallRiskLevel: parsed.risk?.overallRiskLevel ?? "medium",
    riskScore:        parsed.risk?.riskScore        ?? 50,
    keyRisks:         parsed.risk?.keyRisks         ?? [],
    redFlags:         parsed.risk?.redFlags         ?? [],
    regulatoryRisks:  parsed.risk?.regulatoryRisks  ?? "",
    competitiveRisks: parsed.risk?.competitiveRisks ?? "",
    macroRisks:       parsed.risk?.macroRisks       ?? "",
    financialRisks:   parsed.risk?.financialRisks   ?? "",
  };

  emit(s("moatAnalyzer", "complete",
    `Moat: ${moatAnalysis.moatScore}/100 · ${moatAnalysis.moatType.join(", ") || "N/A"}`,
    { score: moatAnalysis.moatScore }
  ));
  emit(s("riskAssessor", "complete",
    `Risk: ${String(riskAssessment.overallRiskLevel).toUpperCase()} (${riskAssessment.riskScore}/100)`,
    { riskLevel: riskAssessment.overallRiskLevel }
  ));

  return { moatAnalysis, riskAssessment };
}

// ─── NODE 4: Decision Maker ───────────────────────────────────────────────────

export async function decisionMakerNode(
  state: AgentState,
  emit: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  emit(s("decisionMaker", "running", "Synthesising final investment decision…"));

  const SYSTEM = `You are a Chief Investment Officer making a final investment decision. You MUST base your verdict entirely on the research data provided.
Return ONLY this JSON with no markdown:
{
  "verdict": "INVEST",
  "confidence": 72,
  "targetHorizon": "medium-term",
  "overallScore": 68,
  "scores": {
    "financialHealth": 70,
    "growthPotential": 75,
    "competitiveMoat": 65,
    "managementQuality": 70,
    "valuationFairness": 60,
    "sentimentMomentum": 68
  },
  "reasoning": "2-3 sentence explanation grounded in the data",
  "bullCase": ["specific bull point 1", "specific bull point 2", "specific bull point 3"],
  "bearCase": ["specific bear point 1", "specific bear point 2"],
  "keyWatchPoints": ["what to monitor 1", "what to monitor 2"],
  "riskRewardRating": "Favorable",
  "suggestedWeight": "3-5%"
}
verdict: INVEST (strong opportunity) | PASS (avoid) | WATCH (wait for catalyst).
riskRewardRating: Favorable | Neutral | Unfavorable.
All scores are 0-100. Be specific — do not use generic phrases.`;

  let raw = "";
  try {
    raw = await llmCall(
      [
        new SystemMessage(SYSTEM),
        new HumanMessage(
          `=== RESEARCH DOSSIER: ${state.companyInfo!.name} (${state.companyInfo!.ticker}) ===\n` +
          `Sector: ${state.companyInfo!.sector} / ${state.companyInfo!.industry}\n\n` +
          `FINANCIALS:\n` +
          `  Price: $${state.financialMetrics?.currentPrice ?? "N/A"}\n` +
          `  P/E: ${state.financialMetrics?.peRatio ?? "N/A"}\n` +
          `  Net Margin: ${state.financialMetrics?.netMargin ?? "N/A"}\n` +
          `  Revenue Growth: ${state.financialMetrics?.revenueGrowth ?? "N/A"}\n` +
          `  ROE: ${state.financialMetrics?.roe ?? "N/A"}\n` +
          `  Debt/Equity: ${state.financialMetrics?.debtToEquity ?? "N/A"}\n` +
          `  Free Cash Flow: ${state.financialMetrics?.freeCashFlow ?? "N/A"}\n` +
          `  52-wk High: $${state.financialMetrics?.fiftyTwoWeekHigh ?? "N/A"} | Low: $${state.financialMetrics?.fiftyTwoWeekLow ?? "N/A"}\n\n` +
          `NEWS SENTIMENT: ${state.newsAnalysis?.overallSentiment} (score: ${state.newsAnalysis?.sentimentScore})\n` +
          `  Catalysts: ${JSON.stringify(state.newsAnalysis?.catalysts)}\n` +
          `  Concerns: ${JSON.stringify(state.newsAnalysis?.concerns)}\n` +
          `  Key Themes: ${JSON.stringify(state.newsAnalysis?.keyThemes)}\n\n` +
          `COMPETITIVE MOAT: ${state.moatAnalysis?.moatScore}/100\n` +
          `  Type: ${JSON.stringify(state.moatAnalysis?.moatType)}\n` +
          `  Advantages: ${JSON.stringify(state.moatAnalysis?.competitiveAdvantages)}\n` +
          `  Market Position: ${state.moatAnalysis?.marketPosition}\n\n` +
          `RISK: ${state.riskAssessment?.overallRiskLevel} (${state.riskAssessment?.riskScore}/100)\n` +
          `  Key Risks: ${JSON.stringify(state.riskAssessment?.keyRisks)}\n` +
          `  Red Flags: ${JSON.stringify(state.riskAssessment?.redFlags)}\n\n` +
          `Return your investment decision JSON now:`
        ),
      ],
      {
        onHeartbeat: () => emit(s("decisionMaker", "running", "AI deliberating on verdict…")),
        onRateLimit: (sec) => emit(s("decisionMaker", "running", `Rate limited — retrying in ${sec}s…`)),
      }
    );
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    emit(s("decisionMaker", "error",
      isTimeout ? "Model timed out on decision — please retry" : `Error: ${msg}`
    ));
    throw new Error(`Decision failed: ${isTimeout ? "model timed out" : msg}`);
  }

  const decision = parseJson(raw) as InvestmentDecision | null;
  if (!decision?.verdict) {
    emit(s("decisionMaker", "error", "AI returned invalid decision — please retry"));
    throw new Error("AI did not produce a valid investment decision. Please retry.");
  }

  emit(s("decisionMaker", "complete",
    `${decision.verdict} · ${decision.confidence}% confidence · Score ${decision.overallScore}/100`,
    { verdict: decision.verdict, confidence: decision.confidence }
  ));
  return { decision };
}
