// Agent State Types
export interface CompanyInfo {
  name: string;
  ticker: string;
  sector: string;
  industry: string;
  description: string;
  marketCap?: string;
  employees?: string;
  founded?: string;
  headquarters?: string;
  website?: string;
  exchange?: string;
}

export interface FinancialMetrics {
  currentPrice?: number;
  peRatio?: number;
  pbRatio?: number;
  psRatio?: number;
  evEbitda?: number;
  revenueGrowth?: string;
  grossMargin?: string;
  operatingMargin?: string;
  netMargin?: string;
  roe?: string;
  debtToEquity?: string;
  currentRatio?: string;
  freeCashFlow?: string;
  dividendYield?: string;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  analystTargetPrice?: number;
  revenuePerShare?: string;
  eps?: string;
  bookValuePerShare?: string;
}

export interface NewsItem {
  title: string;
  summary: string;
  sentiment: "positive" | "negative" | "neutral";
  url?: string;
  date?: string;
}

export interface NewsAnalysis {
  overallSentiment: "positive" | "negative" | "neutral" | "mixed";
  sentimentScore: number; // -1 to 1
  recentNews: NewsItem[];
  keyThemes: string[];
  catalysts: string[];
  concerns: string[];
}

export interface MoatAnalysis {
  moatScore: number; // 0-100
  moatType: string[];
  competitiveAdvantages: string[];
  marketPosition: string;
  competitorComparison: string;
  switchingCosts: string;
  brandStrength: string;
  networkEffects: string;
  costAdvantages: string;
}

export interface RiskAssessment {
  overallRiskLevel: "low" | "medium" | "high" | "very-high";
  riskScore: number; // 0-100 (higher = more risky)
  keyRisks: string[];
  redFlags: string[];
  regulatoryRisks: string;
  competitiveRisks: string;
  macroRisks: string;
  financialRisks: string;
}

export interface InvestmentScores {
  financialHealth: number;    // 0-100
  growthPotential: number;    // 0-100
  competitiveMoat: number;    // 0-100
  managementQuality: number;  // 0-100
  valuationFairness: number;  // 0-100
  sentimentMomentum: number;  // 0-100
}

export interface InvestmentDecision {
  verdict: "INVEST" | "PASS" | "WATCH";
  confidence: number; // 0-100
  targetHorizon: "short-term" | "medium-term" | "long-term";
  overallScore: number; // 0-100
  scores: InvestmentScores;
  reasoning: string;
  bullCase: string[];
  bearCase: string[];
  keyWatchPoints: string[];
  riskRewardRating: string;
  suggestedWeight?: string;
}

export interface AgentState {
  // Input
  companyQuery: string;
  
  // Research results
  companyInfo?: CompanyInfo;
  financialMetrics?: FinancialMetrics;
  newsAnalysis?: NewsAnalysis;
  moatAnalysis?: MoatAnalysis;
  riskAssessment?: RiskAssessment;
  
  // Final decision
  decision?: InvestmentDecision;
  
  // Agent tracking
  steps: AgentStep[];
  currentNode?: string;
  error?: string;
  rawFinancialData?: string;
  rawNewsData?: string;
  rawMoatData?: string;
}

export interface AgentStep {
  node: string;
  status: "running" | "complete" | "error";
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}
