import { NextRequest } from "next/server";
import { runResearchGraph } from "@/lib/agent/graph";
import type { AgentStep } from "@/lib/agent/state";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { company } = await req.json();

  if (!company || typeof company !== "string" || company.trim().length < 2) {
    return new Response(JSON.stringify({ error: "Please provide a valid company name." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };

      const onStep = (step: AgentStep) => {
        send({ type: "step", step });
      };

      try {
        send({ type: "start", company: company.trim() });

        const finalState = await runResearchGraph(company.trim(), onStep);

        send({
          type: "complete",
          state: {
            companyInfo: finalState.companyInfo,
            financialMetrics: finalState.financialMetrics,
            newsAnalysis: finalState.newsAnalysis,
            moatAnalysis: finalState.moatAnalysis,
            riskAssessment: finalState.riskAssessment,
            decision: finalState.decision,
            steps: finalState.steps,
          },
        });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "An unexpected error occurred.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
