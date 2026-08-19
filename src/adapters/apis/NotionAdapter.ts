import "reflect-metadata";

import {
  APIErrorCode,
  Client,
  ClientErrorCode,
  collectPaginatedAPI,
  extractDatabaseId,
  isFullBlock,
  isFullDataSource,
  isFullDatabase,
  isFullPage,
  isNotionClientError,
  type PageObjectResponse,
} from "@notionhq/client";
import { inject, injectable } from "inversify";

import { err, ok, type Result } from "../../core/domain/result.js";
import {
  NotionPageSchema,
  type CreateProjectTaskInput,
  type IntegrationConfig,
  type IntegrationError,
  type NotionPage,
  type ProjectTaskBoard,
  type UpsertChildPageInput,
  type UpsertProjectPageInput,
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

  async upsertProjectPage(
    input: UpsertProjectPageInput,
  ): Promise<Result<NotionPage>> {
    const started = Date.now();
    try {
      const pages = await this.listDatabasePages();
      if (!pages.ok) {
        return pages;
      }
      const existing = pages.value.find((page) => page.title === input.title);
      const pageId = existing
        ? await this.markProjectInProgress(existing.pageId, input.select)
        : await this.createProjectPage(input);
      const page = await this.getPage(pageId);
      if (!page.ok) {
        return page;
      }
      console.log("[NotionAdapter.upsertProjectPage]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
      });
      return page;
    } catch (cause: unknown) {
      return this.fail("upsertProjectPage", started, cause);
    }
  }

  async ensureProjectTaskBoard(
    pageId: string,
  ): Promise<Result<ProjectTaskBoard>> {
    const started = Date.now();
    try {
      const databaseId =
        (await this.findChildDatabaseId(pageId, "Tarefas")) ??
        (await this.createTasksDatabase(pageId));
      const dataSourceId = await this.dataSourceIdOf(databaseId);
      await this.ensureBoardView(dataSourceId, databaseId);
      const existingTitles = await this.listDataSourceTitles(dataSourceId);
      console.log("[NotionAdapter.ensureProjectTaskBoard]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
      });
      return ok({ dataSourceId, existingTitles });
    } catch (cause: unknown) {
      return this.fail("ensureProjectTaskBoard", started, cause);
    }
  }

  async createProjectTask(
    input: CreateProjectTaskInput,
  ): Promise<Result<NotionPage>> {
    const started = Date.now();
    try {
      const dataSource = await this.client.dataSources.retrieve({
        data_source_id: input.dataSourceId,
      });
      if (!isFullDataSource(dataSource)) {
        throw new Error("Data source de Tarefas incompleto");
      }
      const titleName = titlePropertyName(dataSource.properties);
      const statusName = statusPropertyName(dataSource.properties);
      const created = await this.client.pages.create({
        parent: { data_source_id: input.dataSourceId },
        properties: {
          [titleName]: {
            title: [{ type: "text", text: { content: input.title } }],
          },
          [statusName]: {
            select: { name: input.column },
          },
        },
      });
      if (!isFullPage(created)) {
        throw new Error("Card de tarefa Notion incompleto");
      }
      const page = toPage(created);
      console.log("[NotionAdapter.createProjectTask]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId: page.pageId,
      });
      return ok(page);
    } catch (cause: unknown) {
      return this.fail("createProjectTask", started, cause);
    }
  }

  private async createProjectPage(
    input: UpsertProjectPageInput,
  ): Promise<string> {
    const databaseId = requireNotionProjectsDbId();
    const properties: Record<
      string,
      | { title: Array<{ type: "text"; text: { content: string } }> }
      | { status: { name: string } }
      | { select: { name: string } }
    > = {
      "Nome do Projeto": {
        title: [{ type: "text", text: { content: input.title } }],
      },
      Status: { status: { name: "Em andamento" } },
    };
    if (input.select) {
      properties.Selecionar = { select: { name: input.select } };
    }
    const created = await this.client.pages.create({
      parent: { database_id: databaseId },
      properties,
    });
    return created.id;
  }

  private async markProjectInProgress(
    pageId: string,
    select: UpsertProjectPageInput["select"],
  ): Promise<string> {
    const properties: Record<
      string,
      { status: { name: string } } | { select: { name: string } }
    > = {
      Status: { status: { name: "Em andamento" } },
    };
    if (select) {
      properties.Selecionar = { select: { name: select } };
    }
    await this.client.pages.update({ page_id: pageId, properties });
    return pageId;
  }

  private async findChildDatabaseId(
    pageId: string,
    title: string,
  ): Promise<string | null> {
    const blocks = await collectPaginatedAPI(this.client.blocks.children.list, {
      block_id: pageId,
    });
    for (const block of blocks) {
      if (
        isFullBlock(block) &&
        block.type === "child_database" &&
        block.child_database.title === title
      ) {
        return block.id;
      }
    }
    return null;
  }

  private async createTasksDatabase(pageId: string): Promise<string> {
    const created = await this.client.databases.create({
      parent: { type: "page_id", page_id: pageId },
      title: [{ type: "text", text: { content: "Tarefas" } }],
      is_inline: true,
      initial_data_source: {
        properties: {
          Nome: { type: "title", title: {} },
          Status: {
            type: "select",
            select: {
              options: [
                { name: "BACKLOG", color: "gray" },
                { name: "TO DO", color: "blue" },
                { name: "DOING", color: "orange" },
                { name: "DONE", color: "green" },
              ],
            },
          },
        },
      },
    });
    if (!isFullDatabase(created)) {
      throw new Error("Banco Tarefas incompleto");
    }
    return created.id;
  }

  private async dataSourceIdOf(databaseId: string): Promise<string> {
    const database = await this.client.databases.retrieve({
      database_id: databaseId,
    });
    const source = isFullDatabase(database)
      ? database.data_sources[0]
      : undefined;
    if (!source) {
      throw new Error("Banco Tarefas sem data source");
    }
    return source.id;
  }

  private async ensureBoardView(
    dataSourceId: string,
    databaseId: string,
  ): Promise<void> {
    const dataSource = await this.client.dataSources.retrieve({
      data_source_id: dataSourceId,
    });
    if (!isFullDataSource(dataSource)) {
      return;
    }
    const status = Object.values(dataSource.properties).find(
      (property) => property.name === "Status" && property.type === "select",
    );
    if (!status) {
      return;
    }
    try {
      await this.client.views.create({
        data_source_id: dataSourceId,
        database_id: databaseId,
        name: "Kanban",
        type: "board",
        configuration: {
          type: "board",
          group_by: {
            type: "select",
            property_id: status.id,
            sort: { type: "ascending" },
          },
        },
      });
    } catch {
      // Vista board é auxílio; o quadro já existe como banco filho.
    }
  }

  private async listDataSourceTitles(
    dataSourceId: string,
  ): Promise<string[]> {
    const titles: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await this.client.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const result of response.results) {
        if (isFullPage(result)) {
          titles.push(readAnyTitle(result));
        }
      }
      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);
    return titles;
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

function titlePropertyName(
  properties: Record<string, { type: string; name: string }>,
): string {
  for (const property of Object.values(properties)) {
    if (property.type === "title") {
      return property.name;
    }
  }
  return "Nome";
}

function statusPropertyName(
  properties: Record<string, { type: string; name: string }>,
): string {
  for (const property of Object.values(properties)) {
    if (property.type === "select" && property.name === "Status") {
      return property.name;
    }
  }
  for (const property of Object.values(properties)) {
    if (property.type === "select") {
      return property.name;
    }
  }
  return "Status";
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
