"use client";
import React from "react";
import type { InvestmentDecision, CompanyInfo } from "@/lib/agent/state";

interface DecisionCardProps {
  decision: InvestmentDecision;
  company: CompanyInfo;
}

const SCORE_CONFIG: {
  key: keyof InvestmentDecision["scores"];
  label: string;
  icon: string;
  color: string;
}[] = [
  { key: "financialHealth",    label: "Financial Health",    icon: "📊", color: "#3b82f6" },
  { key: "growthPotential",    label: "Growth Potential",    icon: "📈", color: "#8b5cf6" },
  { key: "competitiveMoat",    label: "Competitive Moat",    icon: "🏰", color: "#10b981" },
  { key: "managementQuality",  label: "Management Quality",  icon: "👔", color: "#06b6d4" },
  { key: "valuationFairness",  label: "Valuation Fairness",  icon: "⚖️", color: "#f59e0b" },
  { key: "sentimentMomentum",  label: "Sentiment Momentum",  icon: "🔥", color: "#f97316" },
];

function scoreColor(v: number) {
  if (v >= 70) return "#10b981";
  if (v >= 50) return "#f59e0b";
  return "#ef4444";
}

export default function DecisionCard({ decision, company }: DecisionCardProps) {
  const verdictLower = decision.verdict.toLowerCase() as "invest" | "pass" | "watch";
  const verdictIcon = decision.verdict === "INVEST" ? "▲" : decision.verdict === "PASS" ? "▼" : "◆";
  const rrClass = decision.riskRewardRating?.toLowerCase().includes("fav") ? "favorable"
    : decision.riskRewardRating?.toLowerCase().includes("unfav") ? "unfavorable" : "neutral";

  return (
    <div className="decision-card">
      {/* Banner */}
      <div className={`decision-banner ${verdictLower}`}>
        <div className={`verdict-badge ${verdictLower}`}>
          <span className="verdict-icon">{verdictIcon}</span>
          {decision.verdict}
        </div>
        <div className="company-name-display">{company.name}</div>
        <div className="ticker-display">{company.ticker} · {company.exchange}</div>

        {/* Confidence bar */}
        <div className="confidence-row">
          <div className="confidence-label">
            <span>Confidence</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-primary)" }}>
              {decision.confidence}%
            </span>
          </div>
          <div className="confidence-bar-track">
            <div
              className={`confidence-bar-fill ${verdictLower}`}
              style={{ width: `${decision.confidence}%` }}
            />
          </div>
        </div>

        {/* Overall Score */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{
            fontSize: 48,
            fontWeight: 900,
            fontFamily: "var(--font-mono)",
            color: scoreColor(decision.overallScore),
            lineHeight: 1,
          }}>
            {decision.overallScore}
          </span>
          <span style={{ fontSize: 18, color: "var(--text-muted)" }}>/100</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontFamily: "var(--font-mono)", letterSpacing: "0.5px" }}>
          OVERALL SCORE
        </span>
      </div>

      <div className="decision-divider" />

      {/* Meta row */}
      <div className="decision-meta">
        <div className="meta-item">
          <span className="meta-label">Horizon</span>
          <span className="meta-value" style={{ textTransform: "capitalize" }}>
            {decision.targetHorizon?.replace("-", " ")}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Risk/Reward</span>
          <span className={`meta-value ${rrClass}`}>{decision.riskRewardRating}</span>
        </div>
        {decision.suggestedWeight && (
          <div className="meta-item">
            <span className="meta-label">Suggested Weight</span>
            <span className="meta-value">{decision.suggestedWeight}</span>
          </div>
        )}
        <div className="meta-item">
          <span className="meta-label">Sector</span>
          <span className="meta-value" style={{ fontSize: 12, color: "var(--text-accent)" }}>{company.sector}</span>
        </div>
      </div>

      <div className="decision-divider" />

      {/* Score Breakdown */}
      <div style={{ padding: "16px 20px" }}>
        <div className="reasoning-label" style={{ marginBottom: 12 }}>Score Breakdown</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {SCORE_CONFIG.map(({ key, label, icon, color }) => {
            const val = decision.scores?.[key] ?? 0;
            return (
              <div key={key} className="score-row">
                <div className="score-row-top">
                  <span className="score-row-label">
                    <span>{icon}</span> {label}
                  </span>
                  <span className="score-row-value" style={{ color: scoreColor(val) }}>{val}</span>
                </div>
                <div className="score-bar-track">
                  <div
                    className="score-bar-fill"
                    style={{ width: `${val}%`, background: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="decision-divider" />

      {/* Reasoning */}
      <div className="decision-reasoning">
        <div className="reasoning-label">Analysis</div>
        <p className="reasoning-text">{decision.reasoning}</p>
      </div>

      <div className="decision-divider" />

      {/* Bull / Bear */}
      <div className="bull-bear-section">
        {decision.bullCase?.length > 0 && (
          <div className="bull-bear-group">
            <div className="bull-bear-title bull">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              Bull Case
            </div>
            {decision.bullCase.map((b, i) => (
              <div key={i} className="bull-bear-item">
                <span className="bull-bear-dot bull" />
                <span>{b}</span>
              </div>
            ))}
          </div>
        )}
        {decision.bearCase?.length > 0 && (
          <div className="bull-bear-group">
            <div className="bull-bear-title bear">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                <polyline points="17 18 23 18 23 12" />
              </svg>
              Bear Case
            </div>
            {decision.bearCase.map((b, i) => (
              <div key={i} className="bull-bear-item">
                <span className="bull-bear-dot bear" />
                <span>{b}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
