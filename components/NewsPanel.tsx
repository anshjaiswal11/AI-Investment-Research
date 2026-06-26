"use client";
import React from "react";
import type { NewsAnalysis } from "@/lib/agent/state";

interface NewsPanelProps {
  news: NewsAnalysis;
}

function SentimentBar({ score }: { score: number }) {
  const pct = ((score + 1) / 2) * 100;
  const color = score > 0.2 ? "#10b981" : score < -0.2 ? "#ef4444" : "#f59e0b";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 5, fontFamily: "var(--font-mono)" }}>
        <span>Negative</span>
        <span style={{ color, fontWeight: 700 }}>Score: {score.toFixed(2)}</span>
        <span>Positive</span>
      </div>
      <div style={{ height: 6, background: "var(--bg-surface)", borderRadius: 3, position: "relative" }}>
        <div style={{
          position: "absolute",
          left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: `linear-gradient(90deg, #ef4444, #f59e0b, #10b981)`,
          borderRadius: 3,
          transition: "width 1s ease",
        }} />
        <div style={{
          position: "absolute",
          left: `${pct}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 12,
          height: 12,
          background: color,
          border: "2px solid var(--bg-card)",
          borderRadius: "50%",
          transition: "left 1s ease",
          boxShadow: `0 0 8px ${color}`,
        }} />
      </div>
    </div>
  );
}

export default function NewsPanel({ news }: NewsPanelProps) {
  const sentimentColor = news.overallSentiment === "positive" ? "var(--green-text)"
    : news.overallSentiment === "negative" ? "var(--red-text)"
    : "var(--yellow-text)";

  return (
    <div className="news-card">
      <div className="card-header">
        <div className="card-header-icon" style={{ background: "rgba(245,158,11,0.12)" }}>
          <span>📰</span>
        </div>
        <span className="card-header-title">News & Sentiment</span>
        <span style={{
          marginLeft: "auto",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "capitalize",
          color: sentimentColor,
          fontFamily: "var(--font-mono)",
          padding: "2px 8px",
          background: `${sentimentColor}18`,
          border: `1px solid ${sentimentColor}40`,
          borderRadius: 20,
        }}>
          {news.overallSentiment}
        </span>
      </div>

      {/* Sentiment bar */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <SentimentBar score={news.sentimentScore ?? 0} />
      </div>

      {/* Themes + Catalysts */}
      {(news.keyThemes?.length > 0 || news.catalysts?.length > 0) && (
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {news.keyThemes?.slice(0, 4).map((theme, i) => (
            <span key={i} style={{
              fontSize: 11,
              padding: "3px 10px",
              background: "rgba(59,130,246,0.08)",
              border: "1px solid rgba(59,130,246,0.2)",
              borderRadius: 20,
              color: "var(--accent-bright)",
              fontFamily: "var(--font-mono)",
            }}>
              {theme}
            </span>
          ))}
          {news.catalysts?.slice(0, 2).map((cat, i) => (
            <span key={i} style={{
              fontSize: 11,
              padding: "3px 10px",
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.2)",
              borderRadius: 20,
              color: "var(--green-text)",
              fontFamily: "var(--font-mono)",
            }}>
              ↑ {cat}
            </span>
          ))}
        </div>
      )}

      {/* News list */}
      <div className="news-list">
        {news.recentNews?.slice(0, 4).map((item, i) => (
          <div key={i} className="news-item">
            <div className="news-item-top">
              <span className={`news-sentiment-dot ${item.sentiment}`} />
              <span className="news-title">{item.title}</span>
            </div>
            <p className="news-summary">{item.summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
