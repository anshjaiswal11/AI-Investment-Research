/**
 * nodes.ts — Optimised for speed on free-tier OpenRouter models.
 *
 * Architecture change (6 LLM calls → 3):
 *  1. companyResolverNode  — 1 Tavily search  + 1 LLM call
 *  2. combinedResearchNode — 1 Tavily search  + 2 Alpha Vantage calls (parallel REST) + 1 LLM call
 *                            returns: financialMetrics + newsAnalysis + moatAnalysis + riskAssessment
 *  3. decisionMakerNode    — 0 extra searches + 1 LLM call
 *
 * Data fetches inside each node run in parallel (Promise.all) — no extra time cost.
 * LLM calls are sequential to avoid 429s on the free tier.
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

const llm = new ChatOpenAI({
  model: "openai/gpt-oss-120b:free",
  apiKey: process.env.OPENROUTER_API_KEY!,
  temperature: 0.1,
  maxRetries: 0,
  timeout: 90_000,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "NexusAI",
    },
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Invoke the LLM with a hard wall-clock timeout + exponential back-off on 429.
 * A heartbeat callback fires every 20s so the UI stays alive.
 */
async function llmInvoke(
  messages: (SystemMessage | HumanMessage)[],
  onHeartbeat?: () => void,
  retries = 1,
  delayMs = 10_000
): Promise<string> {
  const TIMEOUT_MS = 90_000;
  const HEARTBEAT_INTERVAL = 20_000;

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (onHeartbeat) {
    heartbeatTimer = setInterval(onHeartbeat, HEARTBEAT_INTERVAL);
  }

  const controller = new AbortController();
  const wallTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await Promise.race([
      llm.invoke(messages),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () =>
          reject(new Error("LLM_TIMEOUT"))
        )
      ),
    ]);
    return response.content as string;
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("LLM_TIMEOUT")) throw err;
    const is429 =
      msg.includes("429") || msg.includes("RateLimit") ||
      msg.includes("rate_limit") || msg.includes("capacity");
    if (is429 && retries > 0) {
      await sleep(delayMs);
      return llmInvoke(messages, onHeartbeat, retries - 1, delayMs * 2);
    }
    throw err;
  } finally {
    clearTimeout(wallTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(text: string): any {
  try {
    const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  } catch {
    return {};
  }
}

function step(
  node: string,
  status: "running" | "complete" | "error",
  message: string,
  data?: Record<string, unknown>
): AgentStep {
  return { node, status, message, timestamp: Date.now(), data };
}

// ─── Fallbacks ────────────────────────────────────────────────────────────────

const fallbackNews: NewsAnalysis = {
  overallSentiment: "neutral", sentimentScore: 0,
  recentNews: [], keyThemes: [], catalysts: [], concerns: [],
};
const fallbackMoat: MoatAnalysis = {
  moatScore: 50, moatType: [], competitiveAdvantages: [],
  marketPosition: "N/A", competitorComparison: "N/A",
  switchingCosts: "N/A", brandStrength: "N/A",
  networkEffects: "N/A", costAdvantages: "N/A",
};
const fallbackRisk: RiskAssessment = {
  overallRiskLevel: "medium", riskScore: 50,
  keyRisks: [], redFlags: [],
  regulatoryRisks: "N/A", competitiveRisks: "N/A",
  macroRisks: "N/A", financialRisks: "N/A",
};

// ─── NODE 1: Company Resolver ─────────────────────────────────────────────────

export async function companyResolverNode(
  state: AgentState,
  onStep: (s: AgentStep) => void
): Promise<Partial<AgentState>> {
  onStep(step("companyResolver", "running", `Identifying "${state.companyQuery}"…`));

  try {
    const searchResult = await searchWeb.invoke({
      query: `${state.companyQuery} stock ticker exchange sector site:finance.yahoo.com OR site:nasdaq.com`,
      maxResults: 3,
    });

    const content = await llmInvoke(
      [
        new SystemMessage(
          'Return ONLY this JSON, no markdown:\n' +
          '{"name":"","ticker":"","sector":"","industry":"","description":"","marketCap":"","founded":"","headquarters":"","website":"","exchange":""}'
        ),
        new HumanMessage(`Query:"${state.companyQuery}"\n${searchResult}\nJSON:`),
      ],
      () => onStep(step("companyResolver", "running", "Still identifying company…"))
    );

    const companyInfo = parseJson(content) as CompanyInfo;
    if (!companyInfo?.ticker) throw new Error(`Could not identify "${state.companyQuery}"`);

    onStep(step("companyResolver", "complete",
      `✓ ${companyInfo.name} (${companyInfo.ticker}) · ${companyInfo.exchange}`,
      { company: companyInfo }
    ));
    return { companyInfo };
  } catch (err) {
    onStep(step("companyResolver", "error", `Failed: ${String(err)}`));
    throw err;
  }
}

// ─── NODE 2: Combined Research (financials + news + moat + risk in ONE call) ──

export async function combinedResearchNode(
  state: AgentState,
  onStep: (s: AgentStep) => void
): Promise<Partial<AgentState>> {
  const company = state.companyInfo!;
  onStep(step("financialAnalyst", "running", `Fetching data for ${company.ticker}…`));

  // All data fetches run IN PARALLEL — zero extra wait time
  const [overview, quote, newsAndMoat] = await Promise.allSettled([
    getCompanyOverview.invoke({ ticker: company.ticker }),
    getStockQuote.invoke({ ticker: company.ticker }),
    searchWeb.invoke({
      query: `${company.name} news earnings competitive advantage 2025`,
      maxResults: 5,
    }),
  ]);

  const overviewText  = overview.status  === "fulfilled" ? overview.value  : "Unavailable";
  const quoteText     = quote.status     === "fulfilled" ? quote.value     : "Unavailable";
  const newsText      = newsAndMoat.status === "fulfilled" ? newsAndMoat.value : "Unavailable";

  onStep(step("financialAnalyst",  "complete", "Market data fetched ✓"));
  onStep(step("newsAnalyst",       "running",  "Analysing news & sentiment…"));
  onStep(step("moatAnalyzer",      "running",  "Scoring competitive moat…"));
  onStep(step("riskAssessor",      "running",  "Assessing risk profile…"));
  onStep(step("financialAnalyst",  "running",  "Analysing financials with AI…"));

  // ONE LLM call returns all four sections
  let content = "";
  try {
    content = await llmInvoke(
      [
        new SystemMessage(
          `You are an elite investment analyst. Given company data, return ONLY this JSON structure (no markdown, no explanation):
{
  "financials": {
    "currentPrice": null, "peRatio": null, "pbRatio": null, "psRatio": null,
    "revenueGrowth": null, "grossMargin": null, "operatingMargin": null, "netMargin": null,
    "roe": null, "debtToEquity": null, "freeCashFlow": null, "dividendYield": null,
    "fiftyTwoWeekHigh": null, "fiftyTwoWeekLow": null, "analystTargetPrice": null, "eps": null
  },
  "news": {
    "overallSentiment": "neutral", "sentimentScore": 0.0,
    "recentNews": [{"title": "", "summary": "", "sentiment": "neutral", "date": ""}],
    "keyThemes": [], "catalysts": [], "concerns": []
  },
  "moat": {
    "moatScore": 50, "moatType": [],
    "competitiveAdvantages": [], "marketPosition": "",
    "competitorComparison": "", "switchingCosts": "",
    "brandStrength": "", "networkEffects": "", "costAdvantages": ""
  },
  "risk": {
    "overallRiskLevel": "medium", "riskScore": 50,
    "keyRisks": [], "redFlags": [],
    "regulatoryRisks": "", "competitiveRisks": "", "macroRisks": "", "financialRisks": ""
  }
}
Rules: moatScore 0-100 (higher=wider moat). sentimentScore -1 to 1. riskScore 0-100 (higher=riskier). overallRiskLevel: low|medium|high|very-high. Max 4 recentNews items.`
        ),
        new HumanMessage(
          `Company: ${company.name} (${company.ticker}) | Sector: ${company.sector}\n` +
          `FINANCIALS:\n${overviewText}\nQUOTE:\n${quoteText}\n` +
          `NEWS/COMPETITIVE:\n${newsText}\n` +
          `Return the JSON now:`
        ),
      ],
      () => {
        onStep(step("financialAnalyst", "running", "AI still processing data…"));
        onStep(step("newsAnalyst",      "running", "AI still processing data…"));
        onStep(step("moatAnalyzer",     "running", "AI still processing data…"));
        onStep(step("riskAssessor",     "running", "AI still processing data…"));
      }
    );
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    const label = isTimeout ? "Timed out — using defaults" : `Error: ${msg}`;
    onStep(step("financialAnalyst", isTimeout ? "complete" : "error", label));
    onStep(step("newsAnalyst",      isTimeout ? "complete" : "error", label));
    onStep(step("moatAnalyzer",     isTimeout ? "complete" : "error", label));
    onStep(step("riskAssessor",     isTimeout ? "complete" : "error", label));
    return {
      financialMetrics: {} as FinancialMetrics,
      newsAnalysis: fallbackNews,
      moatAnalysis: fallbackMoat,
      riskAssessment: fallbackRisk,
      rawFinancialData: overviewText,
      rawNewsData: newsText,
    };
  }

  const parsed = parseJson(content);

  const financialMetrics: FinancialMetrics = parsed.financials ?? {};
  const newsAnalysis: NewsAnalysis         = { ...fallbackNews,  ...(parsed.news  ?? {}) };
  const moatAnalysis: MoatAnalysis         = { ...fallbackMoat,  ...(parsed.moat  ?? {}) };
  const riskAssessment: RiskAssessment     = { ...fallbackRisk,  ...(parsed.risk  ?? {}) };

  onStep(step("financialAnalyst", "complete",
    `P/E: ${financialMetrics.peRatio ?? "N/A"} · Margin: ${financialMetrics.netMargin ?? "N/A"}`,
    { metrics: financialMetrics }
  ));
  onStep(step("newsAnalyst", "complete",
    `Sentiment: ${String(newsAnalysis.overallSentiment).toUpperCase()} (${(newsAnalysis.sentimentScore ?? 0).toFixed(2)})`,
    { sentiment: newsAnalysis.overallSentiment }
  ));
  onStep(step("moatAnalyzer", "complete",
    `Moat: ${moatAnalysis.moatScore}/100 · ${moatAnalysis.moatType?.join(", ") || "N/A"}`,
    { score: moatAnalysis.moatScore }
  ));
  onStep(step("riskAssessor", "complete",
    `Risk: ${String(riskAssessment.overallRiskLevel).toUpperCase()} (${riskAssessment.riskScore}/100)`,
    { riskLevel: riskAssessment.overallRiskLevel }
  ));

  return {
    financialMetrics,
    newsAnalysis,
    moatAnalysis,
    riskAssessment,
    rawFinancialData: overviewText,
    rawNewsData: newsText,
  };
}

// ─── NODE 3: Decision Maker ───────────────────────────────────────────────────

export async function decisionMakerNode(
  state: AgentState,
  onStep: (s: AgentStep) => void
): Promise<Partial<AgentState>> {
  onStep(step("decisionMaker", "running", "Synthesising final investment decision…"));

  let content = "";
  try {
    content = await llmInvoke(
      [
        new SystemMessage(
          'CIO-level decision. Return ONLY this JSON (no markdown):\n' +
          '{"verdict":"INVEST|PASS|WATCH","confidence":70,"targetHorizon":"medium-term","overallScore":60,' +
          '"scores":{"financialHealth":60,"growthPotential":60,"competitiveMoat":60,"managementQuality":60,"valuationFairness":60,"sentimentMomentum":60},' +
          '"reasoning":"","bullCase":[""],"bearCase":[""],"keyWatchPoints":[""],' +
          '"riskRewardRating":"Neutral","suggestedWeight":"2-3%"}\n' +
          'verdict: INVEST=strong buy | PASS=avoid | WATCH=wait for catalyst'
        ),
        new HumanMessage(
          `${state.companyInfo!.name} (${state.companyInfo!.ticker}) — ${state.companyInfo!.sector}\n` +
          `P/E=${state.financialMetrics?.peRatio ?? "N/A"} · margin=${state.financialMetrics?.netMargin ?? "N/A"} · growth=${state.financialMetrics?.revenueGrowth ?? "N/A"} · D/E=${state.financialMetrics?.debtToEquity ?? "N/A"}\n` +
          `Sentiment: ${state.newsAnalysis?.overallSentiment} (${state.newsAnalysis?.sentimentScore})\n` +
          `Moat: ${state.moatAnalysis?.moatScore}/100 · ${JSON.stringify(state.moatAnalysis?.moatType)}\n` +
          `Risk: ${state.riskAssessment?.overallRiskLevel} (${state.riskAssessment?.riskScore}/100)\n` +
          `Red flags: ${JSON.stringify(state.riskAssessment?.redFlags)}\n` +
          `Catalysts: ${JSON.stringify(state.newsAnalysis?.catalysts)}\n` +
          `Return JSON:`
        ),
      ],
      () => onStep(step("decisionMaker", "running", "AI deliberating on verdict…"))
    );
  } catch {
    // Auto-calculate verdict from available scores if LLM fails
  }

  let decision = parseJson(content) as InvestmentDecision;

  // Auto-calculate fallback if LLM returned empty / timed out
  if (!decision?.verdict) {
    const moat  = state.moatAnalysis?.moatScore ?? 50;
    const risk  = state.riskAssessment?.riskScore ?? 50;
    const sent  = ((state.newsAnalysis?.sentimentScore ?? 0) + 1) * 50;
    const score = Math.round((moat + (100 - risk) + sent) / 3);
    const verdict: InvestmentDecision["verdict"] =
      score >= 65 ? "INVEST" : score >= 45 ? "WATCH" : "PASS";

    decision = {
      verdict,
      confidence: 45,
      targetHorizon: "medium-term",
      overallScore: score,
      scores: {
        financialHealth: 50, growthPotential: moat,
        competitiveMoat: moat, managementQuality: 50,
        valuationFairness: 50, sentimentMomentum: Math.round(sent),
      },
      reasoning: `Auto-calculated from available data. Moat: ${moat}/100, Risk: ${risk}/100, Sentiment: ${(state.newsAnalysis?.sentimentScore ?? 0).toFixed(2)}.`,
      bullCase:        state.newsAnalysis?.catalysts?.slice(0, 3) ?? [],
      bearCase:        state.riskAssessment?.keyRisks?.slice(0, 2) ?? [],
      keyWatchPoints:  state.riskAssessment?.keyRisks?.slice(2, 4) ?? [],
      riskRewardRating: risk < 40 ? "Favorable" : risk > 65 ? "Unfavorable" : "Neutral",
      suggestedWeight:  verdict === "INVEST" ? "3-5%" : verdict === "WATCH" ? "1-2%" : "Avoid",
    };
  }

  onStep(step("decisionMaker", "complete",
    `${decision.verdict} · ${decision.confidence}% confidence · Score ${decision.overallScore}/100`,
    { verdict: decision.verdict, confidence: decision.confidence }
  ));
  return { decision };
}

// ─── Keep old node exports for graph.ts compatibility ─────────────────────────
// graph.ts now calls combinedResearchNode instead of the four separate ones.
export { combinedResearchNode as financialAnalystNode };
export { combinedResearchNode as newsAnalystNode };
export { combinedResearchNode as moatAnalyzerNode };
export { combinedResearchNode as riskAssessorNode };
