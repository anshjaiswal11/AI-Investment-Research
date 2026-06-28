import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { searchWeb, getCompanyOverview, getStockQuote, getFinancialStatistics } from "./tools";
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

const MODEL = process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const COMPANY_ALIASES: Record<string, string> = {
  alphabet: "GOOGL",
  google: "GOOGL",
  amazon: "AMZN",
  apple: "AAPL",
  berkshire: "BRK.B",
  "berkshire hathaway": "BRK.B",
  meta: "META",
  facebook: "META",
  microsoft: "MSFT",
  netflix: "NFLX",
  nvidia: "NVDA",
  palantir: "PLTR",
  tesla: "TSLA",
};

interface YahooSearchQuote {
  symbol?: string;
  longname?: string;
  shortname?: string;
  quoteType?: string;
  exchDisp?: string;
  exchange?: string;
  sector?: string;
  sectorDisp?: string;
  industry?: string;
  industryDisp?: string;
}

function s(
  node: string,
  status: "running" | "complete" | "error",
  message: string,
  data?: Record<string, unknown>
): AgentStep {
  return { node, status, message, timestamp: Date.now(), data };
}

async function timed<T>(
  emit: (step: AgentStep) => void,
  node: string,
  message: string,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    emit(s(node, "running", `${message} in ${((Date.now() - started) / 1000).toFixed(1)}s`));
  }
}

async function llmCall(
  messages: (SystemMessage | HumanMessage)[],
  opts: {
    onHeartbeat?: () => void;
    onRateLimit?: (waitSec: number) => void;
    retries?: number;
    delayMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  const { onHeartbeat, onRateLimit, retries = 2, delayMs = 45_000, timeoutMs = 180_000 } = opts;
  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(), timeoutMs);
  const heartbeat = onHeartbeat ? setInterval(onHeartbeat, 25_000) : null;

  try {
    return await openRouterChat(messages, abort.signal);
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("LLM_TIMEOUT")) throw err;

    const isRateLimit =
      msg.includes("429") ||
      msg.includes("RateLimit") ||
      msg.includes("rate_limit") ||
      msg.includes("capacity") ||
      msg.includes("MODEL_RATE_LIMIT");

    if (isRateLimit && retries > 0) {
      const waitSec = Math.round(delayMs / 1000);
      onRateLimit?.(waitSec);
      await sleep(delayMs);
      return llmCall(messages, {
        onHeartbeat,
        onRateLimit,
        retries: retries - 1,
        delayMs: Math.min(delayMs + 30_000, 120_000),
      });
    }

    throw err;
  } finally {
    clearTimeout(abortTimer);
    if (heartbeat) clearInterval(heartbeat);
  }
}

async function openRouterChat(
  messages: (SystemMessage | HumanMessage)[],
  signal: AbortSignal
): Promise<string> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "NexusAI",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 1200,
        messages: messages.map((message) => ({
          role: message instanceof SystemMessage ? "system" : "user",
          content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        })),
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenRouter HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(data.error?.message ?? `OpenRouter returned no message content: ${text.slice(0, 500)}`);
    }
    return content;
  } catch (err) {
    if (signal.aborted) {
      throw new Error("LLM_TIMEOUT: model did not respond in 180 s");
    }
    throw err;
  }
}

function parseJson<T = Record<string, unknown>>(text: string): T | null {
  try {
    const cleaned = text
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as T) : null;
  } catch {
    return null;
  }
}

function parseMaybeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "" || value === "None" || value === "-") {
    return undefined;
  }
  const num = Number(String(value).replace(/[$,%]/g, ""));
  return Number.isFinite(num) ? num : undefined;
}

function toPercent(value: unknown): string | undefined {
  const num = toNumber(value);
  if (num === undefined) return undefined;
  const pct = typeof value === "string" && value.includes("%") ? num : Math.abs(num) <= 1 ? num * 100 : num;
  return `${pct.toFixed(2)}%`;
}

function ratioToPercent(value: unknown): string | undefined {
  const num = toNumber(value);
  if (num === undefined) return undefined;
  const pct = typeof value === "string" && value.includes("%") ? num : num * 100;
  return `${pct.toFixed(2)}%`;
}

function ratioPercent(numerator: unknown, denominator: unknown): string | undefined {
  const num = toNumber(numerator);
  const den = toNumber(denominator);
  if (num === undefined || den === undefined || den === 0) return undefined;
  return `${((num / den) * 100).toFixed(2)}%`;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const num = toNumber(value);
    if (num !== undefined) return num;
  }
  return undefined;
}

function firstStringNumber(...values: unknown[]): string | undefined {
  const num = firstNumber(...values);
  return num === undefined ? undefined : String(num);
}

function normalizeCompanyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(inc|inc\.|corp|corp\.|corporation|company|co|co\.|ltd|ltd\.|plc|class [ab])\b/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyTicker(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === trimmed.toUpperCase() && /^[A-Z][A-Z.-]{0,7}$/.test(trimmed);
}

async function resolveTickerWithoutModel(query: string): Promise<CompanyInfo | null> {
  const normalized = normalizeCompanyName(query);
  const aliasTicker = COMPANY_ALIASES[normalized];
  const directTicker = aliasTicker ?? (isLikelyTicker(query) ? query.trim().toUpperCase() : undefined);

  if (directTicker) {
    return {
      name: directTicker,
      ticker: directTicker,
      sector: "",
      industry: "",
      description: "",
    };
  }

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "Mozilla/5.0" },
      }
    );
    if (!response.ok) return null;

    const data = (await response.json()) as { quotes?: YahooSearchQuote[] };
    const quote = data.quotes?.find((item) => {
      const symbol = item.symbol ?? "";
      return item.quoteType === "EQUITY" && /^[A-Z][A-Z.-]{0,7}$/.test(symbol);
    });
    if (!quote?.symbol) return null;

    return {
      name: safeString(quote.longname ?? quote.shortname ?? quote.symbol),
      ticker: quote.symbol.toUpperCase(),
      sector: safeString(quote.sectorDisp ?? quote.sector),
      industry: safeString(quote.industryDisp ?? quote.industry),
      description: "",
      exchange: safeString(quote.exchDisp ?? quote.exchange),
    };
  } catch {
    return null;
  }
}

function buildFinancialMetrics(overviewRaw: string, quoteRaw: string, statsRaw = ""): FinancialMetrics {
  const overview = parseMaybeJson(overviewRaw) ?? {};
  const quote = parseMaybeJson(quoteRaw) ?? {};
  const stats = parseMaybeJson(statsRaw) ?? {};

  return {
    currentPrice: firstNumber(quote.price, stats.currentPrice),
    peRatio: firstNumber(overview.TrailingPE, overview.PERatio, stats.PERatio, stats.ForwardPE),
    pbRatio: firstNumber(overview.PriceToBookRatio, stats.PriceToBookRatio),
    psRatio: firstNumber(overview.PriceToSalesRatioTTM, stats.PriceToSalesRatioTTM),
    evEbitda: firstNumber(overview.EVToEBITDA, stats.EVToEBITDA),
    revenueGrowth: toPercent(overview.QuarterlyRevenueGrowthYOY) ?? (stats.RevenueGrowthForecast ? `${stats.RevenueGrowthForecast} forecast` : undefined),
    grossMargin: toPercent(stats.GrossMargin) ?? ratioPercent(overview.GrossProfitTTM, overview.RevenueTTM),
    operatingMargin: toPercent(overview.OperatingMarginTTM) ?? toPercent(stats.OperatingMarginTTM),
    netMargin: toPercent(overview.ProfitMargin) ?? toPercent(stats.ProfitMargin),
    roe: ratioToPercent(overview.ReturnOnEquityTTM) ?? toPercent(stats.ReturnOnEquityTTM),
    debtToEquity: firstStringNumber(overview.DebtToEquityRatio, stats.DebtToEquityRatio),
    currentRatio: firstStringNumber(overview.CurrentRatio, stats.CurrentRatio),
    freeCashFlow: stats.FreeCashFlowMargin ? `${stats.FreeCashFlowMargin} margin` : undefined,
    dividendYield: toPercent(overview.DividendYield) ?? toPercent(stats.DividendYield),
    fiftyTwoWeekHigh: firstNumber(overview["52WeekHigh"], stats.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: firstNumber(overview["52WeekLow"], stats.fiftyTwoWeekLow),
    analystTargetPrice: firstNumber(overview.AnalystTargetPrice),
    revenuePerShare: overview.RevenuePerShareTTM ? String(overview.RevenuePerShareTTM) : undefined,
    eps: overview.EPS ? String(overview.EPS) : stats.EPS ? String(stats.EPS) : undefined,
    bookValuePerShare: overview.BookValue ? String(overview.BookValue) : undefined,
  };
}

function safeString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function buildNewsFallback(newsRaw: string): NewsAnalysis {
  const text = newsRaw.toLowerCase();
  const positiveWords = ["beat", "growth", "strong", "record", "upgrade", "positive", "surge", "profit", "demand", "bullish"];
  const negativeWords = ["miss", "decline", "weak", "downgrade", "negative", "lawsuit", "probe", "risk", "fall", "bearish"];
  const positiveHits = positiveWords.reduce((sum, word) => sum + (text.match(new RegExp(`\\b${word}\\b`, "g"))?.length ?? 0), 0);
  const negativeHits = negativeWords.reduce((sum, word) => sum + (text.match(new RegExp(`\\b${word}\\b`, "g"))?.length ?? 0), 0);
  const sentimentScore = Math.max(-0.8, Math.min(0.8, (positiveHits - negativeHits) / 10));
  const overallSentiment: NewsAnalysis["overallSentiment"] =
    sentimentScore > 0.2 ? "positive" :
    sentimentScore < -0.2 ? "negative" :
    positiveHits > 0 && negativeHits > 0 ? "mixed" : "neutral";

  const recentNews = newsRaw
    .split(/\n\n---\n\n/)
    .map((block) => {
      const title = block.match(/Title:\s*(.+)/)?.[1]?.trim();
      const summary = block.match(/Content:\s*([\s\S]+)/)?.[1]?.trim();
      if (!title && !summary) return null;
      const itemSentiment: "positive" | "negative" | "neutral" =
        overallSentiment === "negative" ? "negative" : overallSentiment === "positive" ? "positive" : "neutral";
      return {
        title: title ?? "Recent company update",
        summary: (summary ?? block).slice(0, 180),
        sentiment: itemSentiment,
        date: "recent",
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 3);

  return {
    overallSentiment,
    sentimentScore: Number(sentimentScore.toFixed(2)),
    recentNews,
    keyThemes: ["earnings", "market sentiment", "competitive position"],
    catalysts: positiveHits > negativeHits ? ["Positive news momentum"] : [],
    concerns: negativeHits > positiveHits ? ["Negative headline pressure"] : [],
  };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function buildMoatRisk(
  state: AgentState,
  research: string
): { moatAnalysis: MoatAnalysis; riskAssessment: RiskAssessment } {
  const co = state.companyInfo!;
  const text = `${research} ${co.description ?? ""} ${co.industry ?? ""} ${co.sector ?? ""}`.toLowerCase();
  const sentimentScore = Number(state.newsAnalysis?.sentimentScore ?? 0);
  const pe = state.financialMetrics?.peRatio ?? 0;
  const debt = toNumber(state.financialMetrics?.debtToEquity) ?? 0;

  const moatTypes: string[] = [];
  const advantages: string[] = [];
  let moatScore = 45;

  if (includesAny(text, ["ecosystem", "switching cost", "retention", "subscription", "installed base"])) {
    moatTypes.push("switching costs");
    advantages.push("Customer lock-in and product ecosystem can reduce churn.");
    moatScore += 12;
  }
  if (includesAny(text, ["brand", "premium", "loyal", "recognition"])) {
    moatTypes.push("intangible assets");
    advantages.push("Brand strength supports pricing power and customer loyalty.");
    moatScore += 10;
  }
  if (includesAny(text, ["network effect", "marketplace", "platform", "developer"])) {
    moatTypes.push("network effects");
    advantages.push("Platform scale can improve utility as adoption grows.");
    moatScore += 10;
  }
  if (includesAny(text, ["scale", "supply chain", "cost advantage", "manufacturing", "distribution"])) {
    moatTypes.push("cost advantage");
    advantages.push("Scale and operational reach may create cost advantages.");
    moatScore += 8;
  }
  if (includesAny(text, ["market share", "leader", "dominant", "largest"])) {
    advantages.push("Strong market position appears repeatedly in recent research.");
    moatScore += 8;
  }

  moatScore += sentimentScore > 0.4 ? 5 : sentimentScore < -0.4 ? -5 : 0;
  if (moatTypes.length === 0) moatTypes.push("none");
  if (advantages.length === 0) advantages.push("No durable advantage was clearly established from the fetched research.");

  let riskScore = 42;
  const keyRisks: string[] = [];
  const redFlags: string[] = [];

  if (pe > 35) {
    riskScore += 12;
    keyRisks.push("Premium valuation leaves less room for execution misses.");
  }
  if (debt > 2) {
    riskScore += 10;
    keyRisks.push("Elevated leverage could reduce flexibility if conditions weaken.");
  }
  if (sentimentScore < -0.25) {
    riskScore += 12;
    redFlags.push("Recent sentiment is negative.");
  }
  if (includesAny(text, ["regulatory", "antitrust", "lawsuit", "investigation"])) {
    riskScore += 8;
    keyRisks.push("Regulatory or legal scrutiny appears in recent research.");
  }
  if (includesAny(text, ["competition", "competitor", "pricing pressure", "margin pressure"])) {
    riskScore += 8;
    keyRisks.push("Competitive pressure could weigh on growth or margins.");
  }
  if (keyRisks.length === 0) keyRisks.push("Execution risk and macro sensitivity remain the main watch items.");

  const finalMoatScore = clamp(moatScore);
  const finalRiskScore = clamp(riskScore);
  const overallRiskLevel: RiskAssessment["overallRiskLevel"] =
    finalRiskScore >= 75 ? "very-high" :
    finalRiskScore >= 60 ? "high" :
    finalRiskScore >= 35 ? "medium" : "low";

  return {
    moatAnalysis: {
      moatScore: finalMoatScore,
      moatType: [...new Set(moatTypes)],
      competitiveAdvantages: advantages.slice(0, 4),
      marketPosition: finalMoatScore >= 65
        ? `${co.name} appears to hold a defensible position based on brand, scale, or ecosystem signals.`
        : `${co.name} has some competitive strengths, but the fetched research did not prove a wide moat.`,
      competitorComparison: "Competitive position is inferred from recent web research and available financial context.",
      switchingCosts: moatTypes.includes("switching costs") ? "Switching costs appear meaningful." : "Switching costs were not clearly established.",
      brandStrength: moatTypes.includes("intangible assets") ? "Brand strength appears to be a meaningful advantage." : "Brand strength was not a dominant signal.",
      networkEffects: moatTypes.includes("network effects") ? "Network effects may contribute to defensibility." : "Network effects were not clearly established.",
      costAdvantages: moatTypes.includes("cost advantage") ? "Scale may support cost advantages." : "Cost advantages were not clearly established.",
    },
    riskAssessment: {
      overallRiskLevel,
      riskScore: finalRiskScore,
      keyRisks: keyRisks.slice(0, 4),
      redFlags,
      regulatoryRisks: includesAny(text, ["regulatory", "antitrust", "lawsuit", "investigation"])
        ? "Regulatory or legal risk is present in recent research."
        : "No major regulatory red flag was identified from the fetched research.",
      competitiveRisks: includesAny(text, ["competition", "competitor", "pricing pressure", "margin pressure"])
        ? "Competition may pressure growth, pricing, or margins."
        : "Competitive risk appears manageable based on fetched research.",
      macroRisks: "Macro conditions, rates, and consumer or enterprise demand could affect near-term performance.",
      financialRisks: pe > 35
        ? "Valuation risk is elevated because multiples are high."
        : "No severe financial risk was inferred from the available metrics.",
    },
  };
}

function buildDecision(state: AgentState): InvestmentDecision {
  const metrics = state.financialMetrics ?? {};
  const news = state.newsAnalysis;
  const moat = state.moatAnalysis;
  const risk = state.riskAssessment;

  const pe = metrics.peRatio ?? 0;
  const roe = toNumber(metrics.roe) ?? 0;
  const growth = toNumber(metrics.revenueGrowth) ?? 0;
  const netMargin = toNumber(metrics.netMargin) ?? 0;
  const sentiment = Number(news?.sentimentScore ?? 0);
  const moatScore = moat?.moatScore ?? 50;
  const riskScore = risk?.riskScore ?? 50;

  const financialHealth = clamp(48 + Math.min(netMargin, 30) + Math.min(roe, 25) - Math.max(riskScore - 55, 0) * 0.35);
  const growthPotential = clamp(52 + growth * 1.1 + sentiment * 12);
  const competitiveMoat = clamp(moatScore);
  const managementQuality = clamp(58 + moatScore * 0.18 + sentiment * 8 - Math.max(riskScore - 65, 0) * 0.2);
  const valuationFairness = pe > 0 ? clamp(82 - Math.max(pe - 18, 0) * 1.4 + Math.min(growth, 20) * 0.6) : 55;
  const sentimentMomentum = clamp(50 + sentiment * 45);

  const scores: InvestmentDecision["scores"] = {
    financialHealth,
    growthPotential,
    competitiveMoat,
    managementQuality,
    valuationFairness,
    sentimentMomentum,
  };

  const overallScore = clamp(
    financialHealth * 0.22 +
      growthPotential * 0.18 +
      competitiveMoat * 0.2 +
      managementQuality * 0.12 +
      valuationFairness * 0.13 +
      sentimentMomentum * 0.15 -
      Math.max(riskScore - 55, 0) * 0.25
  );

  const verdict: InvestmentDecision["verdict"] =
    overallScore >= 68 && riskScore < 70 ? "INVEST" :
    overallScore <= 45 || riskScore >= 78 ? "PASS" : "WATCH";
  const confidence = clamp(55 + Math.abs(overallScore - 55) * 0.45 + Math.abs(riskScore - 50) * 0.15, 50, 88);
  const riskRewardRating = overallScore >= 68 && riskScore < 60
    ? "Favorable"
    : overallScore < 50 || riskScore >= 70
      ? "Unfavorable"
      : "Neutral";

  const co = state.companyInfo!;
  const bullCase = [
    ...(moat?.competitiveAdvantages ?? []).slice(0, 2),
    sentiment > 0.25 ? "Recent news sentiment is supportive." : "",
    growth > 0 ? "Revenue growth is a positive signal." : "",
  ].filter(Boolean).slice(0, 3);
  const bearCase = [
    ...(risk?.keyRisks ?? []).slice(0, 2),
    pe > 35 ? "Valuation is demanding versus typical market multiples." : "",
    sentiment < -0.25 ? "Recent news sentiment is negative." : "",
  ].filter(Boolean).slice(0, 3);

  return {
    verdict,
    confidence,
    targetHorizon: verdict === "INVEST" ? "long-term" : "medium-term",
    overallScore,
    scores,
    reasoning:
      `${co.name} scores ${overallScore}/100 with a moat score of ${moatScore}/100 and risk score of ${riskScore}/100. ` +
      `The verdict balances financial quality, valuation, sentiment, moat strength, and key risks from the research pipeline.`,
    bullCase: bullCase.length ? bullCase : ["The company has identifiable strengths, but the strongest upside drivers need more confirmation."],
    bearCase: bearCase.length ? bearCase : ["The main downside is execution risk if growth, margins, or sentiment weaken."],
    keyWatchPoints: [
      "Watch earnings revisions and revenue growth.",
      "Monitor margin trends and competitive pressure.",
      "Track material legal, regulatory, or macro headlines.",
    ],
    riskRewardRating,
    suggestedWeight: verdict === "INVEST" ? "3-5%" : verdict === "WATCH" ? "0-2%" : "0%",
  };
}

export async function companyResolverNode(
  state: AgentState,
  emit: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  emit(s("companyResolver", "running", `Identifying "${state.companyQuery}"...`));

  try {
    const resolved = await timed(emit, "companyResolver", "Ticker resolved", () =>
      resolveTickerWithoutModel(state.companyQuery)
    );

    if (resolved?.ticker) {
      const [overviewRaw, quoteRaw, statsRaw] = await timed(emit, "companyResolver", "Ticker data fetched", () =>
        Promise.all([
          getCompanyOverview.invoke({ ticker: resolved.ticker }),
          getStockQuote.invoke({ ticker: resolved.ticker }),
          getFinancialStatistics.invoke({ ticker: resolved.ticker }),
        ])
      );
      const overview = parseMaybeJson(overviewRaw) ?? {};
      const quote = parseMaybeJson(quoteRaw) ?? {};
      const stats = parseMaybeJson(statsRaw) ?? {};
      const symbol = safeString(overview.Symbol ?? quote.ticker ?? stats.Symbol ?? resolved.ticker);

      const companyInfo: CompanyInfo = {
        name: safeString(overview.Name ?? stats.Name ?? resolved.name ?? symbol),
        ticker: symbol,
        sector: safeString(overview.Sector ?? resolved.sector),
        industry: safeString(overview.Industry ?? resolved.industry),
        description: safeString(overview.Description),
        marketCap: overview.MarketCapitalization ? String(overview.MarketCapitalization) : undefined,
        headquarters: overview.Country ? String(overview.Country) : undefined,
        exchange: overview.Exchange ? String(overview.Exchange) : stats.Exchange ? String(stats.Exchange) : resolved.exchange,
      };

      emit(s("companyResolver", "complete", `Resolved ${companyInfo.name} (${companyInfo.ticker})`, {
        company: companyInfo,
      }));
      return { companyInfo };
    }

    const search = await timed(emit, "companyResolver", "Search completed", () =>
      searchWeb.invoke({
        query: `${state.companyQuery} stock ticker symbol exchange`,
        maxResults: 3,
      })
    );

    const raw = await timed(emit, "companyResolver", "Company resolved by model", () =>
      llmCall(
        [
          new SystemMessage(
            "Return ONLY a JSON object, no markdown:\n" +
              '{"name":"","ticker":"","sector":"","industry":"","description":"1 sentence max","marketCap":"","headquarters":"","exchange":""}'
          ),
          new HumanMessage(`"${state.companyQuery}"\n${search.slice(0, 1000)}`),
        ],
        {
          onHeartbeat: () => emit(s("companyResolver", "running", "Model is working...")),
          onRateLimit: (sec) => emit(s("companyResolver", "running", `Rate limited; retrying in ${sec}s...`)),
        }
      )
    );

    const companyInfo = parseJson(raw) as CompanyInfo | null;
    if (!companyInfo?.ticker) {
      throw new Error(`Could not identify "${state.companyQuery}". Try using the ticker directly, e.g. AAPL.`);
    }

    emit(s("companyResolver", "complete", `Resolved ${companyInfo.name} (${companyInfo.ticker})`, {
      company: companyInfo,
    }));
    return { companyInfo };
  } catch (err) {
    const msg = String(err);
    emit(s("companyResolver", "error", msg.includes("LLM_TIMEOUT")
      ? "Model timed out. The AI is overloaded; please try again."
      : `Failed: ${msg}`));
    throw err;
  }
}

export async function financialNewsNode(
  state: AgentState,
  emit: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  const co = state.companyInfo!;
  emit(s("financialAnalyst", "running", `Fetching financial data for ${co.ticker}...`));
  emit(s("newsAnalyst", "running", `Scanning news for ${co.name}...`));

  const [overview, quote, stats, news] = await timed(emit, "financialAnalyst", "Market and news data fetched", () =>
    Promise.allSettled([
      getCompanyOverview.invoke({ ticker: co.ticker }),
      getStockQuote.invoke({ ticker: co.ticker }),
      getFinancialStatistics.invoke({ ticker: co.ticker }),
      searchWeb.invoke({
        query: `${co.name} ${co.ticker} earnings revenue news analyst 2025`,
        maxResults: 3,
      }),
    ])
  );

  const overviewRaw = overview.status === "fulfilled" ? overview.value : "";
  const quoteRaw = quote.status === "fulfilled" ? quote.value : "";
  const statsRaw = stats.status === "fulfilled" ? stats.value : "";
  const financialRaw = [overviewRaw, quoteRaw, statsRaw].join("\n").slice(0, 2200);
  const newsRaw = (news.status === "fulfilled" ? news.value : "").slice(0, 1200);
  const financialMetrics = buildFinancialMetrics(overviewRaw, quoteRaw, statsRaw);

  emit(s("financialAnalyst", "complete",
    `P/E: ${financialMetrics.peRatio ?? "N/A"} · Net Margin: ${financialMetrics.netMargin ?? "N/A"}`,
    { metrics: financialMetrics }
  ));
  emit(s("newsAnalyst", "running", "AI scoring sentiment..."));

  const system = `You are a market news analyst. Return ONLY this JSON object with no markdown:
{
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
sentimentScore is -1.0 to 1.0. Max 3 recentNews items.`;

  let newsAnalysis: NewsAnalysis | null = null;
  try {
    const raw = await timed(emit, "newsAnalyst", "News sentiment generated", () =>
      llmCall(
        [
          new SystemMessage(system),
          new HumanMessage(`Company: ${co.name} (${co.ticker}) | ${co.sector}\n\nNEWS:\n${newsRaw}\n\nReturn JSON:`),
        ],
        {
          onHeartbeat: () => emit(s("newsAnalyst", "running", "Model still generating news analysis...")),
          onRateLimit: (sec) => emit(s("newsAnalyst", "running", `Rate limited; retrying in ${sec}s...`)),
          timeoutMs: 20_000,
        }
      )
    );
    const parsed = parseJson<{ news?: Partial<NewsAnalysis> }>(raw);
    if (parsed?.news) {
      newsAnalysis = {
        overallSentiment: parsed.news.overallSentiment ?? "neutral",
        sentimentScore: parsed.news.sentimentScore ?? 0,
        recentNews: parsed.news.recentNews ?? [],
        keyThemes: parsed.news.keyThemes ?? [],
        catalysts: parsed.news.catalysts ?? [],
        concerns: parsed.news.concerns ?? [],
      };
    }
  } catch (err) {
    const msg = String(err);
    emit(s("newsAnalyst", "running", `Model sentiment unavailable; using fast fallback (${msg.includes("LLM_TIMEOUT") ? "timeout" : "error"})`));
  }

  if (!newsAnalysis) {
    newsAnalysis = buildNewsFallback(newsRaw);
    emit(s("newsAnalyst", "running", "Fast news sentiment fallback generated"));
  }

  emit(s("newsAnalyst", "complete",
    `Sentiment: ${String(newsAnalysis.overallSentiment).toUpperCase()} (score: ${Number(newsAnalysis.sentimentScore).toFixed(2)})`,
    { sentiment: newsAnalysis.overallSentiment }
  ));

  return { financialMetrics, newsAnalysis, rawFinancialData: financialRaw, rawNewsData: newsRaw };
}

export async function moatRiskNode(
  state: AgentState,
  emit: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  const co = state.companyInfo!;
  emit(s("moatAnalyzer", "running", `Researching competitive moat for ${co.name}...`));
  emit(s("riskAssessor", "running", "Evaluating investment risks..."));

  const moatSearch = await timed(emit, "moatAnalyzer", "Competitive research fetched", () =>
    searchWeb.invoke({
      query: `${co.name} competitive advantage moat market share vs competitors 2025`,
      maxResults: 3,
    }).catch(() => "")
  );

  emit(s("moatAnalyzer", "running", "Scoring moat from research and metrics..."));
  emit(s("riskAssessor", "running", "Scoring risk from research and metrics..."));

  const { moatAnalysis, riskAssessment } = buildMoatRisk(state, moatSearch);

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

export async function decisionMakerNode(
  state: AgentState,
  emit: (step: AgentStep) => void
): Promise<Partial<AgentState>> {
  emit(s("decisionMaker", "running", "Synthesising final investment decision..."));
  const started = Date.now();
  const fastDecision = buildDecision(state);
  emit(s("decisionMaker", "running", `Decision generated in ${((Date.now() - started) / 1000).toFixed(1)}s`));
  emit(s("decisionMaker", "complete",
    `${fastDecision.verdict} · ${fastDecision.confidence}% confidence · Score ${fastDecision.overallScore}/100`,
    { verdict: fastDecision.verdict, confidence: fastDecision.confidence }
  ));
  return { decision: fastDecision };

  const system = `You are a Chief Investment Officer. Base your verdict only on the provided research data.
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
verdict: INVEST | PASS | WATCH. riskRewardRating: Favorable | Neutral | Unfavorable. Scores are 0-100.`;

  let raw = "";
  try {
    raw = await timed(emit, "decisionMaker", "Decision generated", () =>
      llmCall(
        [
          new SystemMessage(system),
          new HumanMessage(
            `=== RESEARCH DOSSIER: ${state.companyInfo!.name} (${state.companyInfo!.ticker}) ===\n` +
              `Sector: ${state.companyInfo!.sector} / ${state.companyInfo!.industry}\n\n` +
              `FINANCIALS:\n` +
              `Price: $${state.financialMetrics?.currentPrice ?? "N/A"}\n` +
              `P/E: ${state.financialMetrics?.peRatio ?? "N/A"}\n` +
              `Net Margin: ${state.financialMetrics?.netMargin ?? "N/A"}\n` +
              `Revenue Growth: ${state.financialMetrics?.revenueGrowth ?? "N/A"}\n` +
              `ROE: ${state.financialMetrics?.roe ?? "N/A"}\n` +
              `Debt/Equity: ${state.financialMetrics?.debtToEquity ?? "N/A"}\n\n` +
              `NEWS SENTIMENT: ${state.newsAnalysis?.overallSentiment} (score: ${state.newsAnalysis?.sentimentScore})\n` +
              `Catalysts: ${JSON.stringify(state.newsAnalysis?.catalysts)}\n` +
              `Concerns: ${JSON.stringify(state.newsAnalysis?.concerns)}\n\n` +
              `COMPETITIVE MOAT: ${state.moatAnalysis?.moatScore}/100\n` +
              `Type: ${JSON.stringify(state.moatAnalysis?.moatType)}\n` +
              `Advantages: ${JSON.stringify(state.moatAnalysis?.competitiveAdvantages)}\n\n` +
              `RISK: ${state.riskAssessment?.overallRiskLevel} (${state.riskAssessment?.riskScore}/100)\n` +
              `Key Risks: ${JSON.stringify(state.riskAssessment?.keyRisks)}\n` +
              `Red Flags: ${JSON.stringify(state.riskAssessment?.redFlags)}\n\n` +
              `Return investment decision JSON:`
          ),
        ],
        {
          onHeartbeat: () => emit(s("decisionMaker", "running", "AI deliberating on verdict...")),
          onRateLimit: (sec) => emit(s("decisionMaker", "running", `Rate limited; retrying in ${sec}s...`)),
        }
      )
    );
  } catch (err) {
    const msg = String(err);
    const isTimeout = msg.includes("LLM_TIMEOUT");
    emit(s("decisionMaker", "error", isTimeout ? "Model timed out on decision; please retry" : `Error: ${msg}`));
    throw new Error(`Decision failed: ${isTimeout ? "model timed out" : msg}`);
  }

  const decision = parseJson(raw) as InvestmentDecision;
  if (!decision?.verdict) {
    emit(s("decisionMaker", "error", "AI returned invalid decision; please retry"));
    throw new Error("AI did not produce a valid investment decision. Please retry.");
  }

  emit(s("decisionMaker", "complete",
    `${decision.verdict} · ${decision.confidence}% confidence · Score ${decision.overallScore}/100`,
    { verdict: decision.verdict, confidence: decision.confidence }
  ));
  return { decision };
}
