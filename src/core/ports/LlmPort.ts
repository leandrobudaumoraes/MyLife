import type { Result } from "../domain/result.js";

/**
 * Porta do modelo de linguagem. O domínio não importa o SDK da OpenAI.
 */
export interface LlmPort {
  complete(prompt: string): Promise<Result<string>>;
}

export type ILlmPort = LlmPort;
