import type { AgentState, AgentStep } from "./state";
import {
  companyResolverNode,
  financialAnalystNode,
  newsAnalystNode,
  moatAnalyzerNode,
  riskAssessorNode,
  decisionMakerNode,
} from "./nodes";

/** Gap between sequential LLM calls — keeps free-tier under per-minute limits. */
const INTER_NODE_DELAY_MS = 2000;

/** Hard ceiling on the entire research pipeline. */
const PIPELINE_TIMEOUT_MS = 180_000; // 3 minutes

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runPipeline(
  companyQuery: string,
  onStep: (step: AgentStep) => void
): Promise<AgentState> {
  let state: AgentState = { companyQuery, steps: [] };

  const addStep = (step: AgentStep) => {
    state.steps.push(step);
    onStep(step);
  };

  // ── 1. Company Resolver ────────────────────────────────────────────────────
  const companyData = await companyResolverNode(state, addStep);
  state = { ...state, ...companyData };

  if (!state.companyInfo) {
    throw new Error(
      "Could not identify company. Try the company's official name or ticker symbol."
    );
  }

  await sleep(INTER_NODE_DELAY_MS);

  // ── 2. Financial Analyst ───────────────────────────────────────────────────
  const financialData = await financialAnalystNode(state, addStep);
  state = { ...state, ...financialData };

  await sleep(INTER_NODE_DELAY_MS);

  // ── 3. News Analyst ────────────────────────────────────────────────────────
  const newsData = await newsAnalystNode(state, addStep);
  state = { ...state, ...newsData };

  await sleep(INTER_NODE_DELAY_MS);

  // ── 4. Moat Analyzer ──────────────────────────────────────────────────────
  const moatData = await moatAnalyzerNode(state, addStep);
  state = { ...state, ...moatData };

  await sleep(INTER_NODE_DELAY_MS);

  // ── 5. Risk Assessor ──────────────────────────────────────────────────────
  const riskData = await riskAssessorNode(state, addStep);
  state = { ...state, ...riskData };

  await sleep(INTER_NODE_DELAY_MS);

  // ── 6. Decision Maker ─────────────────────────────────────────────────────
  const decisionData = await decisionMakerNode(state, addStep);
  state = { ...state, ...decisionData };

  return state;
}

/**
 * Public entry-point: wraps the pipeline with a hard wall-clock timeout.
 * If the whole run exceeds PIPELINE_TIMEOUT_MS the promise rejects immediately.
 */
export async function runResearchGraph(
  companyQuery: string,
  onStep: (step: AgentStep) => void
): Promise<AgentState> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Research timed out after ${PIPELINE_TIMEOUT_MS / 60_000} minutes. The model may be overloaded — please try again.`)),
      PIPELINE_TIMEOUT_MS
    )
  );

  return Promise.race([runPipeline(companyQuery, onStep), timeout]);
}
