"use client";
import React from "react";
import type { FinancialMetrics } from "@/lib/agent/state";

interface MetricsPanelProps {
  metrics: FinancialMetrics;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "None" || v === "-") return "—";
  if (typeof v === "number") return isNaN(v) ? "—" : v.toFixed(2);
  return String(v);
}

function isPositive(label: string, val: string): boolean | null {
  if (val === "—") return null;
  const num = parseFloat(val.replace(/[%$,]/g, ""));
  if (isNaN(num)) return null;
  // For these, higher = good
  const positive = ["Revenue Growth", "Gross Margin", "Operating Margin", "Net Margin", "ROE", "Current Ratio", "Free Cash Flow", "Dividend Yield"];
  // For these, lower = good
  const negative = ["Debt/Equity", "P/E Ratio", "EV/EBITDA"];
  if (positive.some(p => label.includes(p))) return num > 0;
  if (negative.some(p => label.includes(p))) return num < 30 && num > 0;
  return null;
}

interface MetricItem {
  label: string;
  value: string;
}

export default function MetricsPanel({ metrics }: MetricsPanelProps) {
  const valuationMetrics: MetricItem[] = [
    { label: "Current Price",   value: metrics.currentPrice != null ? `$${metrics.currentPrice}` : "—" },
    { label: "P/E Ratio",       value: fmt(metrics.peRatio) },
    { label: "P/B Ratio",       value: fmt(metrics.pbRatio) },
    { label: "P/S Ratio",       value: fmt(metrics.psRatio) },
    { label: "EV/EBITDA",       value: fmt(metrics.evEbitda) },
    { label: "Analyst Target",  value: metrics.analystTargetPrice != null ? `$${metrics.analystTargetPrice}` : "—" },
  ];

  const profitabilityMetrics: MetricItem[] = [
    { label: "Gross Margin",    value: fmt(metrics.grossMargin) },
    { label: "Operating Margin",value: fmt(metrics.operatingMargin) },
    { label: "Net Margin",      value: fmt(metrics.netMargin) },
    { label: "ROE",             value: fmt(metrics.roe) },
    { label: "Revenue Growth",  value: fmt(metrics.revenueGrowth) },
    { label: "Free Cash Flow",  value: fmt(metrics.freeCashFlow) },
  ];

  const balanceSheetMetrics: MetricItem[] = [
    { label: "Debt/Equity",     value: fmt(metrics.debtToEquity) },
    { label: "Current Ratio",   value: fmt(metrics.currentRatio) },
    { label: "EPS",             value: metrics.eps ? `$${fmt(metrics.eps)}` : "—" },
    { label: "Dividend Yield",  value: fmt(metrics.dividendYield) },
    { label: "52W High",        value: metrics.fiftyTwoWeekHigh != null ? `$${metrics.fiftyTwoWeekHigh}` : "—" },
    { label: "52W Low",         value: metrics.fiftyTwoWeekLow  != null ? `$${metrics.fiftyTwoWeekLow}`  : "—" },
  ];

  const renderGroup = (title: string, icon: string, color: string, items: MetricItem[]) => (
    <div className="metrics-card" key={title}>
      <div className="card-header">
        <div className="card-header-icon" style={{ background: `${color}18` }}>
          <span>{icon}</span>
        </div>
        <span className="card-header-title">{title}</span>
      </div>
      <div className="metrics-grid">
        {items.map(({ label, value }) => {
          const pos = isPositive(label, value);
          return (
            <div key={label} className="metric-cell">
              <div className="metric-label-cell">{label}</div>
              <div className={`metric-value-cell ${pos === true ? "positive" : pos === false ? "negative" : ""}`}>
                {value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {renderGroup("Valuation",     "📊", "#3b82f6", valuationMetrics)}
      {renderGroup("Profitability", "💰", "#10b981", profitabilityMetrics)}
      {renderGroup("Balance Sheet", "🏦", "#f59e0b", balanceSheetMetrics)}
    </div>
  );
}
