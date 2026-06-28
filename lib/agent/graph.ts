import type { AgentState, AgentStep } from "./state";
import {
  companyResolverNode,
  combinedResearchNode,
  decisionMakerNode,
} from "./nodes";

/** 3-minute hard ceiling on the entire pipeline. */
const PIPELINE_TIMEOUT_MS = 180_000;

async function runPipeline(
  companyQuery: string,
  onStep: (step: AgentStep) => void
): Promise<AgentState> {
  let state: AgentState = { companyQuery, steps: [] };
  const add = (s: AgentStep) => { state.steps.push(s); onStep(s); };

  // ── 1. Resolve company (1 search + 1 LLM) ─────────────────────────────────
  const resolved = await companyResolverNode(state, add);
  state = { ...state, ...resolved };

  if (!state.companyInfo) {
    throw new Error("Could not identify company. Try the official name or ticker symbol.");
  }

  // ── 2. Combined research (parallel fetches + 1 LLM) ───────────────────────
  //    Returns: financialMetrics + newsAnalysis + moatAnalysis + riskAssessment
  const research = await combinedResearchNode(state, add);
  state = { ...state, ...research };

  // ── 3. Decision (1 LLM) ───────────────────────────────────────────────────
  const decision = await decisionMakerNode(state, add);
  state = { ...state, ...decision };

  return state;
}

/**
 * Public entry-point: wraps the 3-node pipeline with a hard wall-clock timeout.
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
