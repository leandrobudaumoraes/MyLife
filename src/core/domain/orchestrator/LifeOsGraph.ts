import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { LlmPort } from "../../ports/LlmPort.js";

export const AgentStateAnnotation = Annotation.Root({
  prompt: Annotation<string>,
  reply: Annotation<string>,
});

type GraphState = typeof AgentStateAnnotation.State;

/**
 * Grafo mínimo: um nó de raciocínio. Sem regras de negócio.
 * Novos agentes entram como nós daqui.
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

export type LifeOsGraph = ReturnType<typeof createLifeOsGraph>;
