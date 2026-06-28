"use client";
import React, { useState, useCallback, useRef } from "react";
import TickerTape from "@/components/TickerTape";
import AgentFeed from "@/components/AgentFeed";
import DecisionCard from "@/components/DecisionCard";
import MetricsPanel from "@/components/MetricsPanel";
import NewsPanel from "@/components/NewsPanel";
import RiskMoatPanel from "@/components/RiskMoatPanel";
import type {
  AgentStep,
  CompanyInfo,
  FinancialMetrics,
  NewsAnalysis,
  MoatAnalysis,
  RiskAssessment,
  InvestmentDecision,
} from "@/lib/agent/state";

const SUGGESTIONS = ["Apple", "Tesla", "Nvidia", "Amazon", "Microsoft", "Palantir"];

interface ResearchHistory {
  id: string;
  company: CompanyInfo;
  decision: InvestmentDecision;
  timestamp: number;
}

interface ResearchState {
  companyInfo?: CompanyInfo;
  financialMetrics?: FinancialMetrics;
  newsAnalysis?: NewsAnalysis;
  moatAnalysis?: MoatAnalysis;
  riskAssessment?: RiskAssessment;
  decision?: InvestmentDecision;
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [research, setResearch] = useState<ResearchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ResearchHistory[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const runResearch = useCallback(async (companyName: string) => {
    if (!companyName.trim() || isRunning) return;

    // Reset state
    setIsRunning(true);
    setSteps([]);
    setResearch(null);
    setError(null);

    // Abort any previous
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: companyName }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Research failed");
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const msg = JSON.parse(raw);

            if (msg.type === "step") {
              setSteps(prev => {
                // Replace last step if same node and was running, or append
                const last = prev[prev.length - 1];
                if (last?.node === msg.step.node && last.status === "running" && msg.step.status !== "running") {
                  return [...prev.slice(0, -1), msg.step];
                }
                return [...prev, msg.step];
              });
            }

            if (msg.type === "complete") {
              const state: ResearchState = msg.state;
              setResearch(state);
              if (state.companyInfo && state.decision) {
                setHistory(prev => [
                  {
                    id: Date.now().toString(),
                    company: state.companyInfo!,
                    decision: state.decision!,
                    timestamp: Date.now(),
                  },
                  ...prev.slice(0, 9),
                ]);
              }
            }

            if (msg.type === "error") {
              setError(msg.error);
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setError((err as Error)?.message || "An unexpected error occurred.");
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runResearch(query);
  };

  const handleSuggestion = (s: string) => {
    setQuery(s);
    runResearch(s);
  };

  const showFeed = isRunning || steps.length > 0;
  const showResults = research?.decision && research?.companyInfo;

  return (
    <div className="app-wrapper">
      {/* Navigation */}
      <nav className="nav">
        <div className="nav-inner">
          <a href="/" className="nav-logo">
            {/* NexusAI SVG logo */}
            <svg className="nav-logo-svg" width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#60a5fa"/>
                  <stop offset="100%" stopColor="#a78bfa"/>
                </linearGradient>
              </defs>
              <rect width="34" height="34" rx="9" fill="url(#logoGrad)" opacity="0.15"/>
              <rect width="34" height="34" rx="9" stroke="url(#logoGrad)" strokeWidth="1.2"/>
              {/* N shape */}
              <path d="M9 24V10l10 14V10" stroke="url(#logoGrad)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              {/* dot accent */}
              <circle cx="26" cy="12" r="2.5" fill="#60a5fa"/>
            </svg>
            <span className="nav-logo-text">Nexus<span>AI</span></span>
          </a>
          <div className="nav-right">
            <span className="nav-badge">Multi-Agent · LangGraph</span>
            <span className="nav-status"><span className="nav-status-dot" />Live</span>
          </div>
        </div>
      </nav>

      {/* Ticker tape */}
      <TickerTape />

      {/* Main content */}
      <main className="main-content">
        {/* Hero */}
        <section className="hero">
          {/* Animated background grid */}
          <div className="hero-bg" aria-hidden="true">
            <div className="hero-grid" />
            <div className="hero-orb hero-orb-1" />
            <div className="hero-orb hero-orb-2" />
            <div className="hero-orb hero-orb-3" />
          </div>

          {/* Floating stat pills */}
          <div className="hero-stats" aria-hidden="true">
            <div className="hero-stat-pill hero-stat-pill-1">
              <span className="hero-stat-icon">📈</span>
              <span>6 AI Agents</span>
            </div>
            <div className="hero-stat-pill hero-stat-pill-2">
              <span className="hero-stat-icon">⚡</span>
              <span>Real-time Data</span>
            </div>
            <div className="hero-stat-pill hero-stat-pill-3">
              <span className="hero-stat-icon">🎯</span>
              <span>INVEST · PASS · WATCH</span>
            </div>
          </div>

          <div className="hero-eyebrow">
            <span className="hero-eyebrow-dot" />
            Powered by LangGraph &amp; OpenRouter
          </div>

          <h1 className="hero-title">
            Your AI-Powered
            <br />
            <span className="hero-title-highlight">Investment Research</span>
            <br />
            <span className="hero-title-sub">Analyst</span>
          </h1>

          <p className="hero-subtitle">
            Enter any public company. Six specialized AI agents analyse financials,
            news sentiment, competitive moat, and risk — then deliver a clear
            institutional-grade <strong>verdict</strong> in minutes.
          </p>

          {/* Trust badges */}
          <div className="hero-trust">
            <span className="trust-badge"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#10b981" strokeWidth="1.5"/><path d="M3.5 6l1.8 1.8L8.5 4.5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/></svg>Financial Data</span>
            <span className="trust-badge"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#10b981" strokeWidth="1.5"/><path d="M3.5 6l1.8 1.8L8.5 4.5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/></svg>News Sentiment</span>
            <span className="trust-badge"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#10b981" strokeWidth="1.5"/><path d="M3.5 6l1.8 1.8L8.5 4.5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/></svg>Competitive Moat</span>
            <span className="trust-badge"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#10b981" strokeWidth="1.5"/><path d="M3.5 6l1.8 1.8L8.5 4.5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/></svg>Risk Assessment</span>
          </div>

          {/* Search form */}
          <div className="search-container">
            <form onSubmit={handleSubmit}>
              <div className="search-box">
                <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  id="company-search"
                  className="search-input"
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Company name or ticker — e.g. Apple, TSLA, Nvidia…"
                  disabled={isRunning}
                  autoComplete="off"
                  autoFocus
                />
                <button
                  id="run-research-btn"
                  className="search-btn"
                  type="submit"
                  disabled={isRunning || !query.trim()}
                >
                  {isRunning ? (
                    <>
                      <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                      Analysing…
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                      </svg>
                      Run Research
                    </>
                  )}
                </button>
              </div>
            </form>

            <div className="search-suggestions">
              <span className="suggestions-label">Try:</span>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  id={`suggest-${s.toLowerCase()}`}
                  className="suggestion-chip"
                  onClick={() => handleSuggestion(s)}
                  disabled={isRunning}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="error-card">
            <span className="error-icon">⚠️</span>
            <div>
              <div className="error-title">Research Failed</div>
              <div className="error-message">{error}</div>
            </div>
          </div>
        )}

        {/* Agent Feed */}
        {showFeed && <AgentFeed steps={steps} isRunning={isRunning} />}

        {/* Results */}
        {showResults && (
          <section className="results-section">
            <div className="section-header">
              <span className="section-label">Research Results</span>
              <div className="section-line" />
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                {research.companyInfo?.name} · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>

            {/* Company description */}
            {research.companyInfo?.description && (
              <div className="company-card" style={{ marginBottom: 20 }}>
                <div className="card-header">
                  <div className="card-header-icon" style={{ background: "rgba(139,92,246,0.12)" }}>🏢</div>
                  <span className="card-header-title">{research.companyInfo.name}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                    {research.companyInfo.ticker}
                  </span>
                </div>
                <div className="company-body">
                  <p className="company-description">{research.companyInfo.description}</p>
                  <div className="company-tags">
                    {research.companyInfo.sector && (
                      <span className="company-tag sector">{research.companyInfo.sector}</span>
                    )}
                    {research.companyInfo.industry && (
                      <span className="company-tag">{research.companyInfo.industry}</span>
                    )}
                    {research.companyInfo.headquarters && (
                      <span className="company-tag">📍 {research.companyInfo.headquarters}</span>
                    )}
                    {research.companyInfo.founded && (
                      <span className="company-tag">Est. {research.companyInfo.founded}</span>
                    )}
                    {research.companyInfo.employees && (
                      <span className="company-tag">👥 {Number(research.companyInfo.employees).toLocaleString()} employees</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Main grid */}
            <div className="results-grid">
              {/* Left: Decision Card */}
              <div>
                <DecisionCard
                  decision={research.decision!}
                  company={research.companyInfo!}
                />
              </div>

              {/* Right: Research panels */}
              <div className="right-panel">
                {research.financialMetrics && (
                  <MetricsPanel metrics={research.financialMetrics} />
                )}
                {research.newsAnalysis && (
                  <NewsPanel news={research.newsAnalysis} />
                )}
                {research.riskAssessment && research.moatAnalysis && (
                  <RiskMoatPanel
                    risk={research.riskAssessment}
                    moat={research.moatAnalysis}
                  />
                )}

                {/* Watch Points */}
                {(research.decision?.keyWatchPoints?.length ?? 0) > 0 && (
                  <div style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)",
                    overflow: "hidden",
                  }}>
                    <div className="card-header">
                      <div className="card-header-icon" style={{ background: "rgba(59,130,246,0.12)" }}>👁</div>
                      <span className="card-header-title">Key Watch Points</span>
                    </div>
                    <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {research.decision?.keyWatchPoints?.map((w, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                          <span style={{ color: "var(--accent-bright)", flexShrink: 0 }}>→</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* History */}
        {history.length > 0 && (
          <section className="history-section">
            <div className="section-header">
              <span className="section-label">Past Analyses</span>
              <div className="section-line" />
            </div>
            <div className="history-grid">
              {history.map(h => {
                const vl = h.decision.verdict.toLowerCase() as "invest" | "pass" | "watch";
                return (
                  <div
                    key={h.id}
                    className="history-card"
                    onClick={() => handleSuggestion(h.company.name)}
                  >
                    <div className={`history-verdict ${vl}`}>{h.decision.verdict}</div>
                    <div className="history-company">{h.company.name}</div>
                    <div className="history-ticker">{h.company.ticker} · {h.company.sector}</div>
                    <div className={`history-score ${vl}`}>{h.decision.overallScore}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-text">
          AlphaSignal — Built with Next.js · LangGraph.js · Gemini 1.5 Pro
        </div>
        <div className="footer-disclaimer">
          For educational purposes only. Not financial advice. Always conduct your own due diligence.
        </div>
      </footer>
    </div>
  );
}
