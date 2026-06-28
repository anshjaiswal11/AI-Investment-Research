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

const llm = new ChatOpenAI({
  model: "openai/gpt-oss-120b:free",
  apiKey: process.env.OPENROUTER_API_KEY!,
  temperature: 0.1,
  maxRetries: 0,
  timeout: 90_000,   // 90s inside LangChain's own fetch
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "AlphaSignal",
    },
  },
});

// ─── Utilities ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wraps llm.invoke with:
 *  - A hard 90s wall-clock abort via manual AbortController
 *  - A 30s heartbeat callback so the UI shows "still working…"
 *  - Exponential back-off on 429 (up to 2 retries)
 */
async function llmInvoke(
  messages: (SystemMessage | HumanMessage)[],
  onHeartbeat?: () => void,
  retries = 2,
  delayMs = 12_000
): Promise<string> {
  const TIMEOUT_MS = 90_000;
  const HEARTBEAT_MS = 30_000;

  // Heartbeat: fires every 30s while waiting
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  if (onHeartbeat) {
    heartbeatTimer = setTimeout(function beat() {
      onHeartbeat();
      heartbeatTimer = setTimeout(beat, HEARTBEAT_MS);
    }, HEARTBEAT_MS);
  }

  // Wall-clock abort controller
  const controller = new AbortController();
  const wallTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // LangChain uses the `signal` option internally when configured
    const response = await Promise.race([
      llm.invoke(messages),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () =>
          reject(new Error("LLM_TIMEOUT: no response after 90s"))
        )
      ),
    ]);
    return response.content as string;
  } catch (err: unknown) {
    const msg = String(err);

    if (msg.includes("LLM_TIMEOUT")) throw err;
    const is429 =
      msg.includes("429") ||
      msg.includes("RateLimit") ||
      msg.includes("rate_limit") ||
      msg.includes("capacity");

    if (is429 && retries > 0) {
      await sleep(delayMs);
      return llmInvoke(messages, onHeartbeat, retries - 1, delayMs * 2);
    }
    throw err;
  } finally {
    clearTimeout(wallTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
  }
}

/** Strip markdown code fences, return first JSON object found. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(text: string): any {
  try {
    const cleaned = text
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  } catch {
    return {};
  }
}

function makeStep(
  node: string,
  status: "running" | "complete" | "error",
  message: string,
  data?: Record<string, unknown>
): AgentStep {
  return { node, status, message, timestamp: Date.now(), data };
}

// ─── Default fallbacks (so downstream nodes always have something) ─────────────

const defaultFinancials: FinancialMetrics = {};
const defaultNews: NewsAnalysis = {
  overallSentiment: "neutral",
  sentimentScore: 0,
  recentNews: [],
  keyThemes: [],
  catalysts: [],
  concerns: [],
};
const defaultMoat: MoatAnalysis = {
  moatScore: 50,
  moatType: [],
  competitiveAdvantages: [],
  marketPosition: "Unknown",
  competitorComparison: "N/A",
  switchingCosts: "N/A",
  brandStrength: "N/A",
  networkEffects: "N/A",
  costAdvantages: "N/A",
};
const defaultRisk: RiskAssessment = {
  overallRiskLevel: "medium",
  riskScore: 50,
  keyRisks: [],
  redFlags: [],
  regulatoryRisks: "N/A",
  competitiveRisks: "N/A",
  macroRisks: "N/A",
  financialRisks: "N/A",
};

// ─── NODE 1: Company Resolver ─────────────────────────────────────────────────

export async function companyResolverNode(
  state: AgentState,
  onStep: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  onStep(makeStep("companyResolver", "running", `Identifying "${state.companyQuery}"…`));

  try {
    const searchResult = await searchWeb.invoke({
      query: `${state.companyQuery} stock ticker exchange sector`,
      maxResults: 3,
    });

    const content = await llmInvoke(
      [
        new SystemMessage(
          "Financial data resolver. Return ONLY a raw JSON object, no markdown, no explanation.\n" +
          '{"name":"string","ticker":"string","sector":"string","industry":"string",' +
          '"description":"string","marketCap":"string","founded":"string",' +
          '"headquarters":"string","website":"string","exchange":"string"}'
        ),
        new HumanMessage(
          `Company: "${state.companyQuery}"\nSearch results:\n${searchResult}\nReturn JSON only.`
        ),
      ],
      () => onStep(makeStep("companyResolver", "running", "Still identifying company…"))
    );

    const companyInfo = parseJson(content) as CompanyInfo;

    if (!companyInfo?.ticker) {
      throw new Error(`Could not identify ticker for "${state.companyQuery}"`);
    }

    onStep(
      makeStep(
        "companyResolver",
        "complete",
        `Identified: ${companyInfo.name} (${companyInfo.ticker}) · ${companyInfo.exchange}`,
        { company: companyInfo }
      )
    );
    return { companyInfo };
  } catch (err) {
    onStep(makeStep("companyResolver", "error", `Failed: ${String(err)}`));
    throw err; // company ID is mandatory — rethrow
  }
}

// ─── NODE 2: Financial Analyst ────────────────────────────────────────────────

export async function financialAnalystNode(
  state: AgentState,
  onStep: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  const ticker = state.companyInfo!.ticker;
  onStep(makeStep("financialAnalyst", "running", `Fetching market data for ${ticker}…`));

  try {
    const [overview, quote] = await Promise.all([
      getCompanyOverview.invoke({ ticker }),
      getStockQuote.invoke({ ticker }),
    ]);
    const rawFinancialData = `OVERVIEW:\n${overview}\nQUOTE:\n${quote}`;

    onStep(makeStep("financialAnalyst", "running", "Analysing valuation metrics…"));

    const content = await llmInvoke(
      [
        new SystemMessage(
          "Senior equity analyst. Extract metrics. Return ONLY raw JSON, no markdown.\n" +
          '{"currentPrice":null,"peRatio":null,"pbRatio":null,"psRatio":null,"evEbitda":null,' +
          '"revenueGrowth":null,"grossMargin":null,"operatingMargin":null,"netMargin":null,' +
          '"roe":null,"debtToEquity":null,"currentRatio":null,"freeCashFlow":null,' +
          '"dividendYield":null,"fiftyTwoWeekHigh":null,"fiftyTwoWeekLow":null,' +
          '"analystTargetPrice":null,"eps":null,"bookValuePerShare":null}'
        ),
        new HumanMessage(`${state.companyInfo!.name} financials:\n${rawFinancialData}`),
      ],
      () => onStep(makeStep("financialAnalyst", "running", "Model still processing financials…"))
    );

    const financialMetrics = parseJson(content) as FinancialMetrics;

    onStep(
      makeStep(
        "financialAnalyst",
        "complete",
        `Done — P/E: ${financialMetrics.peRatio ?? "N/A"} · Margin: ${financialMetrics.netMargin ?? "N/A"}`,
        { metrics: financialMetrics }
      )
    );
    return { financialMetrics, rawFinancialData };
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    onStep(
      makeStep(
        "financialAnalyst",
        isTimeout ? "complete" : "error",
        isTimeout ? "Model timed out — continuing with raw data only" : `Error: ${msg}`
      )
    );
    return { financialMetrics: defaultFinancials, rawFinancialData: "" };
  }
}

// ─── NODE 3: News Analyst ─────────────────────────────────────────────────────

export async function newsAnalystNode(
  state: AgentState,
  onStep: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  const company = state.companyInfo!;
  onStep(makeStep("newsAnalyst", "running", `Scanning news for ${company.name}…`));

  try {
    const newsResult = await searchWeb.invoke({
      query: `${company.name} ${company.ticker} news earnings outlook 2025`,
      maxResults: 5,
    });

    onStep(makeStep("newsAnalyst", "running", "Scoring sentiment…"));

    const content = await llmInvoke(
      [
        new SystemMessage(
          "Financial news analyst. Return ONLY raw JSON, no markdown.\n" +
          '{"overallSentiment":"positive","sentimentScore":0.0,' +
          '"recentNews":[{"title":"","summary":"","sentiment":"neutral","date":""}],' +
          '"keyThemes":[],"catalysts":[],"concerns":[]}\n' +
          "Max 4 news items. sentimentScore is a float from -1.0 to 1.0."
        ),
        new HumanMessage(
          `${company.name} (${company.ticker}) recent news:\n${newsResult}\nReturn JSON only.`
        ),
      ],
      () => onStep(makeStep("newsAnalyst", "running", "Model still analysing news…"))
    );

    const newsAnalysis = parseJson(content) as NewsAnalysis;

    onStep(
      makeStep(
        "newsAnalyst",
        "complete",
        `Sentiment: ${String(newsAnalysis.overallSentiment ?? "neutral").toUpperCase()} (${(newsAnalysis.sentimentScore ?? 0).toFixed(2)})`,
        { sentiment: newsAnalysis.overallSentiment }
      )
    );
    return { newsAnalysis, rawNewsData: newsResult };
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    onStep(
      makeStep(
        "newsAnalyst",
        isTimeout ? "complete" : "error",
        isTimeout ? "Model timed out — skipping sentiment scoring" : `Error: ${msg}`
      )
    );
    return { newsAnalysis: defaultNews, rawNewsData: "" };
  }
}

// ─── NODE 4: Moat Analyzer ────────────────────────────────────────────────────

export async function moatAnalyzerNode(
  state: AgentState,
  onStep: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  const company = state.companyInfo!;
  onStep(makeStep("moatAnalyzer", "running", `Researching competitive moat for ${company.name}…`));

  try {
    const moatResult = await searchWeb.invoke({
      query: `${company.name} competitive advantage market share moat 2025`,
      maxResults: 4,
    });

    onStep(makeStep("moatAnalyzer", "running", "Scoring economic moat…"));

    const content = await llmInvoke(
      [
        new SystemMessage(
          "Morningstar moat analyst. Return ONLY raw JSON, no markdown.\n" +
          '{"moatScore":50,"moatType":["switching costs"],"competitiveAdvantages":[],' +
          '"marketPosition":"","competitorComparison":"","switchingCosts":"",' +
          '"brandStrength":"","networkEffects":"","costAdvantages":""}\n' +
          "moatScore is 0-100. moatType options: network effects, cost advantage, switching costs, intangible assets, efficient scale, none."
        ),
        new HumanMessage(
          `${company.name} in ${company.sector} / ${company.industry}:\n${moatResult}\nReturn JSON only.`
        ),
      ],
      () => onStep(makeStep("moatAnalyzer", "running", "Model still scoring moat…"))
    );

    const moatAnalysis = parseJson(content) as MoatAnalysis;

    onStep(
      makeStep(
        "moatAnalyzer",
        "complete",
        `Moat: ${moatAnalysis.moatScore ?? 50}/100 · ${moatAnalysis.moatType?.join(", ") || "N/A"}`,
        { score: moatAnalysis.moatScore }
      )
    );
    return { moatAnalysis, rawMoatData: moatResult };
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    onStep(
      makeStep(
        "moatAnalyzer",
        isTimeout ? "complete" : "error",
        isTimeout ? "Model timed out — using default moat score" : `Error: ${msg}`
      )
    );
    return { moatAnalysis: defaultMoat, rawMoatData: "" };
  }
}

// ─── NODE 5: Risk Assessor ────────────────────────────────────────────────────

export async function riskAssessorNode(
  state: AgentState,
  onStep: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  onStep(makeStep("riskAssessor", "running", "Evaluating investment risks…"));

  try {
    const content = await llmInvoke(
      [
        new SystemMessage(
          "Risk management analyst. Return ONLY raw JSON, no markdown.\n" +
          '{"overallRiskLevel":"medium","riskScore":50,"keyRisks":[],"redFlags":[],' +
          '"regulatoryRisks":"","competitiveRisks":"","macroRisks":"","financialRisks":""}\n' +
          "overallRiskLevel: low | medium | high | very-high. riskScore: 0-100 (higher = riskier)."
        ),
        new HumanMessage(
          `Risk for ${state.companyInfo!.name} (${state.companyInfo!.ticker}):\n` +
          `Sector: ${state.companyInfo!.sector}\n` +
          `P/E=${state.financialMetrics?.peRatio ?? "N/A"}, Margin=${state.financialMetrics?.netMargin ?? "N/A"}, D/E=${state.financialMetrics?.debtToEquity ?? "N/A"}\n` +
          `Sentiment: ${state.newsAnalysis?.overallSentiment ?? "N/A"} (score=${state.newsAnalysis?.sentimentScore ?? 0})\n` +
          `Moat: ${state.moatAnalysis?.moatScore ?? 50}/100\n` +
          `Concerns: ${JSON.stringify(state.newsAnalysis?.concerns ?? [])}\n` +
          "Return JSON only."
        ),
      ],
      () => onStep(makeStep("riskAssessor", "running", "Model still assessing risks…"))
    );

    const riskAssessment = parseJson(content) as RiskAssessment;

    onStep(
      makeStep(
        "riskAssessor",
        "complete",
        `Risk: ${String(riskAssessment.overallRiskLevel ?? "medium").toUpperCase()} (${riskAssessment.riskScore ?? 50}/100)`,
        { riskLevel: riskAssessment.overallRiskLevel }
      )
    );
    return { riskAssessment };
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    onStep(
      makeStep(
        "riskAssessor",
        isTimeout ? "complete" : "error",
        isTimeout ? "Model timed out — using default risk profile" : `Error: ${msg}`
      )
    );
    return { riskAssessment: defaultRisk };
  }
}

// ─── NODE 6: Decision Maker ───────────────────────────────────────────────────

export async function decisionMakerNode(
  state: AgentState,
  onStep: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  onStep(makeStep("decisionMaker", "running", "Making final investment decision…"));

  try {
    const content = await llmInvoke(
      [
        new SystemMessage(
          "Chief Investment Officer. Return ONLY raw JSON, no markdown.\n" +
          '{"verdict":"WATCH","confidence":65,"targetHorizon":"medium-term","overallScore":60,' +
          '"scores":{"financialHealth":60,"growthPotential":60,"competitiveMoat":60,"managementQuality":60,"valuationFairness":60,"sentimentMomentum":60},' +
          '"reasoning":"string","bullCase":["string"],"bearCase":["string"],' +
          '"keyWatchPoints":["string"],"riskRewardRating":"Neutral","suggestedWeight":"2-3%"}\n' +
          "verdict: INVEST | PASS | WATCH. riskRewardRating: Favorable | Neutral | Unfavorable."
        ),
        new HumanMessage(
          `Investment decision for ${state.companyInfo!.name} (${state.companyInfo!.ticker}):\n` +
          `Sector: ${state.companyInfo!.sector} / ${state.companyInfo!.industry}\n` +
          `Financials: P/E=${state.financialMetrics?.peRatio ?? "N/A"}, netMargin=${state.financialMetrics?.netMargin ?? "N/A"}, growth=${state.financialMetrics?.revenueGrowth ?? "N/A"}, D/E=${state.financialMetrics?.debtToEquity ?? "N/A"}, FCF=${state.financialMetrics?.freeCashFlow ?? "N/A"}\n` +
          `Sentiment: ${state.newsAnalysis?.overallSentiment ?? "neutral"} (${state.newsAnalysis?.sentimentScore ?? 0})\n` +
          `Moat: ${state.moatAnalysis?.moatScore ?? 50}/100, types=${JSON.stringify(state.moatAnalysis?.moatType ?? [])}\n` +
          `Risk: ${state.riskAssessment?.overallRiskLevel ?? "medium"} (${state.riskAssessment?.riskScore ?? 50}/100)\n` +
          `Red flags: ${JSON.stringify(state.riskAssessment?.redFlags ?? [])}\n` +
          `Catalysts: ${JSON.stringify(state.newsAnalysis?.catalysts ?? [])}\n` +
          "Return JSON only."
        ),
      ],
      () => onStep(makeStep("decisionMaker", "running", "Model still synthesising decision…"))
    );

    const decision = parseJson(content) as InvestmentDecision;

    // Validate required fields, fill defaults if missing
    if (!decision.verdict) decision.verdict = "WATCH";
    if (!decision.confidence) decision.confidence = 50;
    if (!decision.overallScore) decision.overallScore = 50;
    if (!decision.scores) {
      decision.scores = {
        financialHealth: 50, growthPotential: 50, competitiveMoat: 50,
        managementQuality: 50, valuationFairness: 50, sentimentMomentum: 50,
      };
    }

    onStep(
      makeStep(
        "decisionMaker",
        "complete",
        `${decision.verdict} · Confidence ${decision.confidence}% · Score ${decision.overallScore}/100`,
        { verdict: decision.verdict, confidence: decision.confidence }
      )
    );
    return { decision };
  } catch (err) {
    // Decision maker: build a basic verdict from the data we have rather than failing
    const moatScore = state.moatAnalysis?.moatScore ?? 50;
    const riskScore = state.riskAssessment?.riskScore ?? 50;
    const sentiment = state.newsAnalysis?.sentimentScore ?? 0;
    const overallScore = Math.round((moatScore + (100 - riskScore) + ((sentiment + 1) * 50)) / 3);
    const verdict: InvestmentDecision["verdict"] =
      overallScore >= 65 ? "INVEST" : overallScore >= 45 ? "WATCH" : "PASS";

    const decision: InvestmentDecision = {
      verdict,
      confidence: 45,
      targetHorizon: "medium-term",
      overallScore,
      scores: {
        financialHealth: 50,
        growthPotential: moatScore,
        competitiveMoat: moatScore,
        managementQuality: 50,
        valuationFairness: 50,
        sentimentMomentum: Math.round((sentiment + 1) * 50),
      },
      reasoning: `Auto-generated decision based on available data. Moat score: ${moatScore}/100, risk score: ${riskScore}/100, sentiment: ${sentiment.toFixed(2)}.`,
      bullCase: state.newsAnalysis?.catalysts ?? [],
      bearCase: state.riskAssessment?.keyRisks?.slice(0, 2) ?? [],
      keyWatchPoints: state.riskAssessment?.keyRisks?.slice(2, 4) ?? [],
      riskRewardRating: riskScore < 40 ? "Favorable" : riskScore > 65 ? "Unfavorable" : "Neutral",
      suggestedWeight: verdict === "INVEST" ? "3-5%" : verdict === "WATCH" ? "1-2%" : "Avoid",
    };

    onStep(
      makeStep(
        "decisionMaker",
        "complete",
        `${decision.verdict} · Score ${decision.overallScore}/100 (auto-calculated)`,
        { verdict: decision.verdict }
      )
    );
    return { decision };
  }
}
