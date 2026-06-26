"use client";
import React from "react";
import type { RiskAssessment, MoatAnalysis } from "@/lib/agent/state";

interface RiskMoatPanelProps {
  risk: RiskAssessment;
  moat: MoatAnalysis;
}

const RISK_ICONS: Record<string, string> = {
  regulatory: "⚖️",
  competitive: "🏆",
  macro: "🌍",
  financial: "💳",
  default: "⚠️",
};

function MoatMeter({ score }: { score: number }) {
  const bars = 10;
  const filled = Math.round((score / 100) * bars);
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {Array.from({ length: bars }, (_, i) => (
        <div key={i} style={{
          height: 20,
          flex: 1,
          borderRadius: 3,
          background: i < filled ? color : "var(--bg-surface)",
          transition: `background 0.1s ${i * 60}ms`,
          boxShadow: i < filled ? `0 0 4px ${color}60` : "none",
        }} />
      ))}
      <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color }}>{score}</span>
    </div>
  );
}

export default function RiskMoatPanel({ risk, moat }: RiskMoatPanelProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Competitive Moat */}
      <div className="risk-card">
        <div className="card-header">
          <div className="card-header-icon" style={{ background: "rgba(16,185,129,0.12)" }}>
            <span>🏰</span>
          </div>
          <span className="card-header-title">Competitive Moat</span>
        </div>

        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.6px" }}>
            Moat Score
          </div>
          <MoatMeter score={moat.moatScore ?? 0} />
        </div>

        {moat.moatType?.length > 0 && (
          <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {moat.moatType.filter(t => t !== "none").map((t, i) => (
              <span key={i} style={{
                fontSize: 11,
                padding: "3px 10px",
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.2)",
                borderRadius: 20,
                color: "var(--green-text)",
                fontFamily: "var(--font-mono)",
                textTransform: "capitalize",
              }}>
                {t}
              </span>
            ))}
          </div>
        )}

        <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          {moat.competitiveAdvantages?.slice(0, 3).map((adv, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              <span style={{ color: "#10b981", fontSize: 14, flexShrink: 0 }}>✓</span>
              <span>{adv}</span>
            </div>
          ))}
          {moat.marketPosition && (
            <div style={{
              marginTop: 8,
              padding: "8px 12px",
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}>
              <strong style={{ color: "var(--text-primary)" }}>Market Position:</strong> {moat.marketPosition}
            </div>
          )}
        </div>
      </div>

      {/* Risk Assessment */}
      <div className="risk-card">
        <div className="card-header">
          <div className="card-header-icon" style={{ background: "rgba(239,68,68,0.12)" }}>
            <span>⚠️</span>
          </div>
          <span className="card-header-title">Risk Assessment</span>
        </div>

        <div className="risk-level-banner">
          <span className={`risk-level-badge ${risk.overallRiskLevel}`}>
            {risk.overallRiskLevel?.replace("-", " ").toUpperCase()}
          </span>
          <span className="risk-score-text">Score: {risk.riskScore ?? "—"}/100</span>
        </div>

        {/* Red flags */}
        {risk.redFlags?.length > 0 && (
          <div className="red-flags">
            <div className="red-flags-title">🚩 Red Flags</div>
            {risk.redFlags.map((flag, i) => (
              <div key={i} className="red-flag-item">
                <span>•</span>
                <span>{flag}</span>
              </div>
            ))}
          </div>
        )}

        <div className="risk-list">
          {[
            { label: "Regulatory", text: risk.regulatoryRisks, key: "regulatory" },
            { label: "Competitive", text: risk.competitiveRisks, key: "competitive" },
            { label: "Macro",       text: risk.macroRisks,       key: "macro"       },
            { label: "Financial",   text: risk.financialRisks,   key: "financial"   },
          ].filter(r => r.text).map(({ label, text, key }) => (
            <div key={key} className="risk-item">
              <span className="risk-item-icon">{RISK_ICONS[key]}</span>
              <div>
                <strong style={{ fontSize: 11, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "var(--font-mono)" }}>
                  {label}
                </strong>
                <br />
                <span>{text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
