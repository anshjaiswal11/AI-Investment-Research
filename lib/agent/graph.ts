import type { AgentState, AgentStep } from "./state";
import {
  companyResolverNode,
  financialNewsNode,
  moatRiskNode,
  decisionMakerNode,
} from "./nodes";

const PIPELINE_TIMEOUT_MS = 360_000; // 6 min hard cap; retries handle real rate limits.

async function runPipeline(
  companyQuery: string,
  onStep: (step: AgentStep) => void
): Promise<AgentState> {
  let state: AgentState = { companyQuery, steps: [] };
  const add = (step: AgentStep) => {
    state.steps.push(step);
    onStep(step);
  };

  state = { ...state, ...(await companyResolverNode(state, add)) };
  if (!state.companyInfo) throw new Error("Could not identify company.");

  state = { ...state, ...(await financialNewsNode(state, add)) };
  state = { ...state, ...(await moatRiskNode(state, add)) };
  state = { ...state, ...(await decisionMakerNode(state, add)) };

  return state;
}

export async function runResearchGraph(
  companyQuery: string,
  onStep: (step: AgentStep) => void
): Promise<AgentState> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            "Research timed out after 6 minutes. The free-tier model is overloaded right now. " +
              "Please wait 1-2 minutes and try again."
          )
        ),
      PIPELINE_TIMEOUT_MS
    )
  );
  return Promise.race([runPipeline(companyQuery, onStep), timeout]);
}
