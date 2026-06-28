import type { AgentState, AgentStep } from "./state";
import {
  companyResolverNode,
  financialNewsNode,
  moatRiskNode,
  decisionMakerNode,
} from "./nodes";

const PIPELINE_TIMEOUT_MS = 360_000; // 6 min (4 calls × 90s avg + gaps)
const GAP_MS = 8_000;               // 8s between LLM calls — avoids back-to-back 429s

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runPipeline(
  companyQuery: string,
  onStep: (step: AgentStep) => void
): Promise<AgentState> {
  let state: AgentState = { companyQuery, steps: [] };
  const add = (step: AgentStep) => { state.steps.push(step); onStep(step); };

  // 1. Identify company ──────────────────────────────────────────────────────
  state = { ...state, ...(await companyResolverNode(state, add)) };
  if (!state.companyInfo) throw new Error("Could not identify company.");

  await sleep(GAP_MS);

  // 2. Financials + News ─────────────────────────────────────────────────────
  state = { ...state, ...(await financialNewsNode(state, add)) };

  await sleep(GAP_MS);

  // 3. Moat + Risk ───────────────────────────────────────────────────────────
  state = { ...state, ...(await moatRiskNode(state, add)) };

  await sleep(GAP_MS);

  // 4. Investment Decision ───────────────────────────────────────────────────
  state = { ...state, ...(await decisionMakerNode(state, add)) };

  return state;
}

export async function runResearchGraph(
  companyQuery: string,
  onStep: (step: AgentStep) => void
): Promise<AgentState> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(
        "Research timed out after 6 minutes. The free-tier model is overloaded right now. " +
        "Please wait 1–2 minutes and try again."
      )),
      PIPELINE_TIMEOUT_MS
    )
  );
  return Promise.race([runPipeline(companyQuery, onStep), timeout]);
}
