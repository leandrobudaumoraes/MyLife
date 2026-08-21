import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { LlmPort } from "../../ports/LlmPort.js";
import type { ProcessInboxEvents } from "../inbox-event/processInboxEvents.js";
import { ok, type Result } from "../result.js";
import type { InboxEventRun } from "../schemas.js";

export const AgentStateAnnotation = Annotation.Root({
  prompt: Annotation<string>,
  reply: Annotation<string>,
});

type GraphState = typeof AgentStateAnnotation.State;

/**
 * Grafo mínimo de ping do LLM. O fluxo de produto Inbox Event vive em
 * `createInboxEventGraph`.
 */
export function createLifeOsGraph(llm: LlmPort) {
  return new StateGraph(AgentStateAnnotation)
    .addNode("reason", async (state: GraphState) => {
      const result = await llm.complete(state.prompt);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return { reply: result.value };
    })
    .addEdge(START, "reason")
    .addEdge("reason", END)
    .compile();
}

export const InboxEventGraphState = Annotation.Root({
  result: Annotation<Result<InboxEventRun>>({
    reducer: (_previous, next) => next,
    default: () =>
      ok({
        scanned: 0,
        promoted: 0,
        pending: 0,
        failed: 0,
        outcomes: [],
      }),
  }),
});

export function createInboxEventGraph(inboxEvents: ProcessInboxEvents) {
  return new StateGraph(InboxEventGraphState)
    .addNode("inboxEvents", async () => ({
      result: await inboxEvents.execute(),
    }))
    .addEdge(START, "inboxEvents")
    .addEdge("inboxEvents", END)
    .compile();
}

export type LifeOsGraph = ReturnType<typeof createLifeOsGraph>;
export type InboxEventGraph = ReturnType<typeof createInboxEventGraph>;
