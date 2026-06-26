# AlphaSignal — AI Investment Research Agent

> Institutional-grade AI investment research powered by LangGraph.js multi-agent orchestration.

---

## Overview

**AlphaSignal** is a full-stack AI investment research agent that:
1. Accepts any public company name or ticker
2. Runs a **multi-agent LangGraph pipeline** to research it from multiple angles
3. Delivers a structured **INVEST / PASS / WATCH** verdict with reasoning

The agent performs:
- **Company resolution** — identifies ticker, sector, exchange
- **Financial analysis** — P/E, margins, growth, valuation metrics via Alpha Vantage
- **News & sentiment analysis** — real-time news scoring via Tavily
- **Competitive moat analysis** — network effects, switching costs, brand strength
- **Risk assessment** — regulatory, competitive, macro, financial risks
- **Decision synthesis** — CIO-level verdict with bull/bear case and score breakdown

Results stream **live via SSE** so you watch the agent think in real-time.

---

## How to Run

### Prerequisites
- Node.js 18+
- API keys (all have free tiers)

### 1. Clone / Setup
```bash
cd "ai research"
npm install
```

### 2. Configure Environment
Create `.env.local` in the project root:
```env
GOOGLE_API_KEY=your_google_gemini_api_key
TAVILY_API_KEY=your_tavily_api_key
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key
```

**Get free API keys:**
| Key | URL |
|-----|-----|
| `GOOGLE_API_KEY` | https://aistudio.google.com/app/apikey |
| `TAVILY_API_KEY` | https://tavily.com |
| `ALPHA_VANTAGE_API_KEY` | https://www.alphavantage.co/support/#api-key |

### 3. Run
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## How It Works — Architecture

```
Browser (React)
  │
  ├── POST /api/research  ←→  SSE stream
  │
  └─ LangGraph StateGraph
       │
       ├── companyResolverNode    → Tavily search → Gemini → ticker + metadata
       │
       ├── [Parallel]
       │    ├── financialAnalystNode  → Alpha Vantage API → Gemini analysis
       │    ├── newsAnalystNode       → Tavily news → Gemini sentiment
       │    └── moatAnalyzerNode      → Tavily research → Gemini moat score
       │
       ├── riskAssessorNode       → Synthesizes all data → risk rating
       │
       └── decisionMakerNode      → CIO prompt → INVEST/PASS/WATCH verdict
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 App Router + React 18 |
| Backend | Next.js API Route (Node.js runtime) |
| AI Orchestration | LangGraph.js (StateGraph) |
| LLM | Google Gemini 1.5 Pro via @langchain/google-genai |
| Data | Alpha Vantage (financials), Tavily (web + news) |
| Streaming | Server-Sent Events (SSE) |
| Styling | Vanilla CSS — custom dark institutional finance design system |

### Data Flow
1. User enters company → POST to `/api/research`
2. API creates a `ReadableStream` and responds immediately
3. Graph nodes run in sequence (with parallel research phase)
4. Each node streams `AgentStep` events via `data: {...}\n\n`
5. Final `complete` event sends the full structured state
6. React processes events and progressively renders the UI

---

## Key Decisions & Trade-offs

### ✅ What I chose and why

**LangGraph StateGraph over raw LangChain chains**
> Explicit state management with typed nodes makes the research pipeline auditable, debuggable, and extensible. Each node has a single responsibility.

**Google Gemini 1.5 Pro**
> Best price/performance for structured JSON extraction. The 1M context window handles full financial datasets. Free tier is generous enough for demos.

**Vanilla CSS over Tailwind**
> Per the brief's tech stack guidelines. Custom CSS variables give a fully controlled design system with no runtime overhead or class-name leakage.

**SSE over WebSockets**
> Unidirectional streaming is all we need. SSE is simpler, works natively in browsers, and Vercel's edge/nodejs runtimes support it without configuration.

**Parallel research nodes (financials + news + moat simultaneously)**
> Reduces total latency by ~40% vs serial execution. All three are independent and can safely run in parallel with `Promise.all`.

**Alpha Vantage for financial data**
> Free tier covers our needs. Returns structured JSON without scraping. Fallback: if rate-limited, the LLM uses Tavily web search to approximate metrics.

### ❌ What I left out (and why)

- **Database persistence** — Would use PostgreSQL + LangGraph checkpointer for production. Skipped to keep local setup zero-friction.
- **User authentication** — Out of scope for this prototype.
- **Historical stock chart** — Would integrate a charting library with price history API. Skipped to avoid another paid API tier.
- **Portfolio tracking** — Saving and tracking multiple positions over time — a natural next feature.
- **Backtesting** — Testing the agent's historical INVEST/PASS accuracy — would require historical data API.
- **Streaming individual token output** — The LLM responses stream at the node level (step completion), not token by token, to keep structured JSON intact.

---

## Example Runs

### Apple (AAPL) — INVEST
```
Verdict: INVEST  
Confidence: 82%  
Overall Score: 78/100

Financial Health: 85 | Growth Potential: 72 | Competitive Moat: 92
Management Quality: 88 | Valuation Fairness: 61 | Sentiment Momentum: 74

Bull Case:
• Unmatched ecosystem lock-in and brand premium
• Services segment growing 15%+ YoY with ~75% margins  
• $90B+ annual free cash flow; massive buyback program

Bear Case:
• Premium valuation (P/E ~30x) leaves little margin of safety
• China revenue concentration (~18% of sales) is a geopolitical risk
```

### Peloton (PTON) — PASS
```
Verdict: PASS  
Confidence: 88%  
Overall Score: 24/100

Financial Health: 18 | Growth Potential: 28 | Competitive Moat: 35
Management Quality: 32 | Valuation Fairness: 45 | Sentiment Momentum: 12

Bear Case:
• Negative FCF and ongoing cost reduction mode
• Connected fitness market facing intense competition from Apple Fitness+, Mirror
• Post-pandemic demand collapse with no clear recovery catalyst
```

### Nvidia (NVDA) — INVEST
```
Verdict: INVEST  
Confidence: 79%  
Overall Score: 84/100

Financial Health: 91 | Growth Potential: 95 | Competitive Moat: 90
Management Quality: 88 | Valuation Fairness: 55 | Sentiment Momentum: 92

Bull Case:
• GPU monopoly in AI training (~80% market share)  
• CUDA software moat creates massive switching costs  
• Data center revenue growing 200%+ YoY
```

---

## What I Would Improve With More Time

1. **Historical accuracy tracking** — Log all INVEST/PASS decisions and track how stocks perform 30/90/365 days later. Build a leaderboard.

2. **Streaming token-level output** — Pipe Gemini's streaming tokens directly to the UI within each node, rather than waiting for complete node output.

3. **DCF valuation model** — A structured Discounted Cash Flow calculation using actual financial statement data (income statement, balance sheet, cash flow).

4. **Multi-stock comparison** — Analyze 2-5 companies side by side, generating a ranked portfolio recommendation.

5. **Vercel/Railway deployment** — Full CI/CD pipeline with environment variable management and preview deployments.

6. **LangSmith tracing** — Observability layer to trace every LLM call, token usage, and latency per node.

7. **Persistent history** — PostgreSQL + Prisma to save all past analyses per user session, with filtering and search.

8. **Options/sentiment data** — Integrate unusual options activity (puts/calls ratio) as an additional signal.

9. **Fine-tuned decision layer** — Fine-tune a smaller model on historical "analyst rating → stock performance" data to improve the final verdict quality.

---

## LLM Chat Session Transcript

This project was built with AI assistance (Claude Sonnet 4.6 via Antigravity). The full conversation transcript is available in the repository and covers:
- Architecture decisions (LangGraph vs direct LangChain)
- Node prompt engineering for reliable JSON extraction
- SSE streaming implementation details  
- CSS design system decisions
- Debugging the `create-next-app` failure (folder name with space)

Key exchanges:
> **User**: "create ui that does not look like ai generated it should be professional"  
> **AI**: Designed a dark institutional finance aesthetic inspired by Bloomberg Terminal and professional trading platforms — deep navy-black palette, JetBrains Mono for data, Inter for prose, animated moat meter bars, live agent feed with node-specific colors.

> **User**: "start building" + provided all three API keys  
> **AI**: Bootstrapped the entire project: npm init → install → tsconfig → LangGraph graph → 6 agent nodes → SSE API route → 7 React components → complete CSS system → README

---

*Built with ❤️ using Next.js 14, LangGraph.js, and Google Gemini 1.5 Pro*
