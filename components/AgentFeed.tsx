"use client";
import React from "react";
import type { AgentStep } from "@/lib/agent/state";

interface AgentFeedProps {
  steps: AgentStep[];
  isRunning: boolean;
}

const NODE_LABELS: Record<string, string> = {
  companyResolver:  "Company Resolver",
  financialAnalyst: "Financial Analyst",
  newsAnalyst:      "News Analyst",
  moatAnalyzer:     "Moat Analyzer",
  riskAssessor:     "Risk Assessor",
  decisionMaker:    "Decision Maker",
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AgentFeed({ steps, isRunning }: AgentFeedProps) {
  const feedRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [steps]);

  return (
    <div className="agent-feed-section">
      <div className="section-header">
        <span className="section-label">Agent Activity</span>
        <div className="section-line" />
      </div>

      <div className="feed-card">
        <div className="feed-header">
          <div className="feed-title">
            {isRunning && <span className="feed-title-dot" />}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {isRunning ? "Researching..." : "Research complete"}
            </span>
          </div>
          <span className="feed-step-count">{steps.length} steps</span>
        </div>

        <div className="feed-body" ref={feedRef}>
          {steps.map((step, idx) => (
            <div key={idx} className="feed-step">
              <div className={`step-icon-wrap ${step.status}`}>
                {step.status === "running" ? (
                  <span className="spinner" />
                ) : step.status === "complete" ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
              </div>
              <div className="step-content">
                <div className={`step-node ${step.node}`}>
                  {NODE_LABELS[step.node] ?? step.node}
                </div>
                <div className="step-message">{step.message}</div>
                <div className="step-time">{formatTime(step.timestamp)}</div>
              </div>
            </div>
          ))}

          {steps.length === 0 && (
            <div style={{ padding: "24px 18px", color: "var(--text-muted)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
              Waiting for agent to start...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
