import "reflect-metadata";

import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { injectable } from "inversify";

import { err, ok, type Result } from "../../core/domain/result.js";
import type { IntegrationError } from "../../core/domain/schemas.js";
import type { LlmPort } from "../../core/ports/LlmPort.js";

const LLM_TIMEOUT_MS = 25_000;

@injectable()
export class OpenAiAdapter implements LlmPort {
  private readonly chat: ChatOpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY ausente — o motor LangGraph precisa da chave para raciocinar",
      );
    }

    this.chat = new ChatOpenAI({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0,
      apiKey,
      timeout: LLM_TIMEOUT_MS,
    });
  }

  async complete(prompt: string): Promise<Result<string>> {
    const started = Date.now();
    try {
      const response = await this.chat.invoke([new HumanMessage(prompt)]);
      const text = textOf(response.content);
      console.log("[OpenAiAdapter.complete]", {
        ok: true,
        durationMs: Date.now() - started,
      });
      return ok(text);
    } catch (cause: unknown) {
      const error = mapLlmError(cause);
      console.log("[OpenAiAdapter.complete]", {
        ok: false,
        durationMs: Date.now() - started,
        code: error.code,
      });
      return err(error);
    }
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
        return "";
      })
      .join("");
  }
  return JSON.stringify(content);
}

function mapLlmError(cause: unknown): IntegrationError {
  const message =
    cause instanceof Error ? cause.message : "Falha no modelo de linguagem";
  if (/unauthorized|401|api key/i.test(message)) {
    return {
      provider: "llm",
      code: "unauthorized",
      message,
      retryable: false,
      retryAfterMs: null,
      cause,
    };
  }
  if (/timeout/i.test(message)) {
    return {
      provider: "llm",
      code: "timeout",
      message,
      retryable: true,
      retryAfterMs: 400,
      cause,
    };
  }
  if (/429|rate/i.test(message)) {
    return {
      provider: "llm",
      code: "rate_limited",
      message,
      retryable: true,
      retryAfterMs: 1000,
      cause,
    };
  }
  return {
    provider: "llm",
    code: "unavailable",
    message,
    retryable: true,
    retryAfterMs: 400,
    cause,
  };
}
