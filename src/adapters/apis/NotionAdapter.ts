import "reflect-metadata";

import {
  APIErrorCode,
  Client,
  ClientErrorCode,
  collectPaginatedAPI,
  extractDatabaseId,
  isFullDatabase,
  isFullPage,
  isNotionClientError,
  type PageObjectResponse,
} from "@notionhq/client";
import { inject, injectable } from "inversify";

import { err, ok, type Result } from "../../core/domain/result.js";
import {
  NotionPageSchema,
  type IntegrationConfig,
  type IntegrationError,
  type NotionPage,
  type UpsertChildPageInput,
} from "../../core/domain/schemas.js";
import type { NotionPort } from "../../core/ports/NotionPort.js";
import { TOKENS } from "../../core/ports/tokens.js";

@injectable()
export class NotionAdapter implements NotionPort {
  private readonly client: Client;
  private projectsDataSourceId: string | null = null;

  constructor(@inject(TOKENS.Config) config: IntegrationConfig) {
    this.client = new Client({
      auth: config.notionApiKey,
      timeoutMs: 15_000,
    });
  }

  async listDatabasePages(): Promise<Result<readonly NotionPage[]>> {
    const started = Date.now();
    try {
      const dataSourceId = await this.resolveProjectsDataSourceId();
      const pages: NotionPage[] = [];
      let cursor: string | null = null;

      do {
        const response = await this.client.dataSources.query({
          data_source_id: dataSourceId,
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const result of response.results) {
          if (!isFullPage(result)) {
            continue;
          }
          pages.push(toPage(result));
        }
        cursor = response.has_more ? response.next_cursor : null;
      } while (cursor);

      console.log("[NotionAdapter.listDatabasePages]", {
        ok: true,
        durationMs: Date.now() - started,
        count: pages.length,
      });
      return ok(NotionPageSchema.array().parse(pages));
    } catch (cause: unknown) {
      return this.fail("listDatabasePages", started, cause);
    }
  }

  async getPage(pageId: string): Promise<Result<NotionPage>> {
    const started = Date.now();
    try {
      const page = await this.client.pages.retrieve({ page_id: pageId });
      if (!isFullPage(page)) {
        return err({
          provider: "notion",
          code: "not_found",
          message: `Página ${pageId} não é uma página completa`,
          retryable: false,
          retryAfterMs: null,
          cause: null,
        });
      }
      console.log("[NotionAdapter.getPage]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
      });
      return ok(toPage(page));
    } catch (cause: unknown) {
      return this.fail("getPage", started, cause);
    }
  }

  async upsertChildPage(
    input: UpsertChildPageInput,
  ): Promise<Result<NotionPage>> {
    const started = Date.now();
    try {
      const existingId = await this.findChildPageId(input.parentId, input.title);
      const pageId = existingId
        ? await this.replaceMarkdown(existingId, input.markdown)
        : await this.createChildPage(
            input.parentId,
            input.title,
            input.markdown,
          );
      const url = notionPageUrl(pageId);
      console.log("[NotionAdapter.upsertChildPage]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
      });
      return ok(
        NotionPageSchema.parse({
          pageId,
          title: input.title,
          url,
        }),
      );
    } catch (cause: unknown) {
      return this.fail("upsertChildPage", started, cause);
    }
  }

  private async resolveProjectsDataSourceId(): Promise<string> {
    if (this.projectsDataSourceId) {
      return this.projectsDataSourceId;
    }

    const databaseId = requireNotionProjectsDbId();
    const database = await this.client.databases.retrieve({
      database_id: databaseId,
    });
    const source = isFullDatabase(database)
      ? database.data_sources[0]
      : undefined;
    if (!source) {
      throw new Error(
        `NOTION_PROJECTS_DB_ID (${databaseId}) não retornou data source. Confira o ID no .env e o acesso da integração.`,
      );
    }

    this.projectsDataSourceId = source.id;
    return source.id;
  }

  private async findChildPageId(
    parentId: string,
    title: string,
  ): Promise<string | null> {
    const blocks = await collectPaginatedAPI(this.client.blocks.children.list, {
      block_id: parentId,
    });
    for (const block of blocks) {
      if (
        "type" in block &&
        block.type === "child_page" &&
        block.child_page.title === title
      ) {
        return block.id;
      }
    }
    return null;
  }

  private async createChildPage(
    parentId: string,
    title: string,
    markdown: string,
  ): Promise<string> {
    const created = await this.client.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
      markdown,
    });
    return created.id;
  }

  private async replaceMarkdown(
    pageId: string,
    markdown: string,
  ): Promise<string> {
    await this.client.pages.updateMarkdown({
      page_id: pageId,
      type: "replace_content",
      replace_content: {
        new_str: markdown,
        allow_deleting_content: true,
      },
    });
    return pageId;
  }

  private fail(
    operation: string,
    started: number,
    cause: unknown,
  ): Result<never> {
    const error = mapNotionError(cause);
    console.log("[NotionAdapter]", {
      operation,
      ok: false,
      durationMs: Date.now() - started,
      code: error.code,
    });
    return err(error);
  }
}

function requireNotionProjectsDbId(): string {
  const raw = process.env.NOTION_PROJECTS_DB_ID?.trim();
  if (!raw) {
    throw new Error(
      "NOTION_PROJECTS_DB_ID não está definida no .env. Defina o ID do banco de dados do Notion.",
    );
  }

  const databaseId = extractDatabaseId(raw);
  if (!databaseId) {
    throw new Error(
      "NOTION_PROJECTS_DB_ID no .env não é um ID de banco Notion válido.",
    );
  }

  return databaseId;
}

function toPage(page: PageObjectResponse): NotionPage {
  return NotionPageSchema.parse({
    pageId: page.id,
    title: readAnyTitle(page),
    url: page.url,
  });
}

function readAnyTitle(page: PageObjectResponse): string {
  for (const property of Object.values(page.properties)) {
    if (property.type === "title") {
      return property.title.map((item) => item.plain_text).join("");
    }
  }
  return "";
}

function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replaceAll("-", "")}`;
}

function mapNotionError(cause: unknown): IntegrationError {
  if (isNotionClientError(cause)) {
    if (cause.code === APIErrorCode.Unauthorized) {
      return notionError("unauthorized", cause.message, false, null, cause);
    }
    if (cause.code === APIErrorCode.RestrictedResource) {
      return notionError("forbidden_write", cause.message, false, null, cause);
    }
    if (cause.code === APIErrorCode.ObjectNotFound) {
      return notionError("not_found", cause.message, false, null, cause);
    }
    if (cause.code === APIErrorCode.RateLimited) {
      return notionError("rate_limited", cause.message, true, 1000, cause);
    }
    if (
      cause.code === ClientErrorCode.RequestTimeout ||
      cause.code === APIErrorCode.GatewayTimeout
    ) {
      return notionError("timeout", cause.message, true, 400, cause);
    }
    if (cause.code === APIErrorCode.ConflictError) {
      return notionError("conflict", cause.message, true, 400, cause);
    }
    if (
      cause.code === APIErrorCode.ValidationError ||
      cause.code === APIErrorCode.InvalidRequest
    ) {
      return notionError("validation", cause.message, false, null, cause);
    }
    if (
      cause.code === APIErrorCode.InternalServerError ||
      cause.code === APIErrorCode.ServiceUnavailable ||
      cause.code === APIErrorCode.ServiceOverload
    ) {
      return notionError("unavailable", cause.message, true, 400, cause);
    }
  }

  return notionError(
    "unavailable",
    cause instanceof Error ? cause.message : "Falha na API Notion",
    true,
    400,
    cause,
  );
}

function notionError(
  code: IntegrationError["code"],
  message: string,
  retryable: boolean,
  retryAfterMs: number | null,
  cause: unknown,
): IntegrationError {
  return {
    provider: "notion",
    code,
    message,
    retryable,
    retryAfterMs,
    cause,
  };
}
