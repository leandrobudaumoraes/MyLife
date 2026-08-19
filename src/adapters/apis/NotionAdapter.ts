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
  NOTION_EVENTS_DB_TITLE,
  NOTION_EVENTS_DB_TITLE_LEGACY,
  NOTION_PROJECT_STATUS_IN_PROGRESS,
  NOTION_PROJECT_STATUS_NOT_STARTED,
} from "../../core/domain/gtd/catalog.js";
import {
  KanbanColumnSchema,
  NotionPageSchema,
  type CreateProjectEventInput,
  type CreateProjectTaskInput,
  type IntegrationConfig,
  type IntegrationError,
  type KanbanColumn,
  type NotionPage,
  type ProjectEventBoard,
  type ProjectEventCard,
  type ProjectTaskBoard,
  type ProjectTaskCard,
  type UpdateProjectTaskColumnInput,
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
          status: null,
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
        ? await this.writeExistingProjectPage(existing.pageId, input)
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
      const tasks = await this.listDataSourceTasks(dataSourceId);
      console.log("[NotionAdapter.ensureProjectTaskBoard]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
      });
      return ok({ dataSourceId, tasks });
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

  async findProjectTaskBoard(
    pageId: string,
  ): Promise<Result<ProjectTaskBoard | null>> {
    const started = Date.now();
    try {
      const databaseId = await this.findChildDatabaseId(pageId, "Tarefas");
      if (!databaseId) {
        console.log("[NotionAdapter.findProjectTaskBoard]", {
          ok: true,
          durationMs: Date.now() - started,
          pageId,
          found: false,
        });
        return ok(null);
      }
      const dataSourceId = await this.dataSourceIdOf(databaseId);
      const tasks = await this.listDataSourceTasks(dataSourceId);
      console.log("[NotionAdapter.findProjectTaskBoard]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
        found: true,
      });
      return ok({ dataSourceId, tasks });
    } catch (cause: unknown) {
      return this.fail("findProjectTaskBoard", started, cause);
    }
  }

  async ensureProjectEventBoard(
    pageId: string,
  ): Promise<Result<ProjectEventBoard>> {
    const started = Date.now();
    try {
      const databaseId =
        (await this.findChildDatabaseId(pageId, [
          NOTION_EVENTS_DB_TITLE,
          NOTION_EVENTS_DB_TITLE_LEGACY,
        ])) ?? (await this.createEventsDatabase(pageId));
      const dataSourceId = await this.dataSourceIdOf(databaseId);
      const events = await this.listDataSourceEvents(dataSourceId);
      console.log("[NotionAdapter.ensureProjectEventBoard]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
      });
      return ok({ dataSourceId, events });
    } catch (cause: unknown) {
      return this.fail("ensureProjectEventBoard", started, cause);
    }
  }

  async createProjectEvent(
    input: CreateProjectEventInput,
  ): Promise<Result<NotionPage>> {
    const started = Date.now();
    try {
      const dataSource = await this.client.dataSources.retrieve({
        data_source_id: input.dataSourceId,
      });
      if (!isFullDataSource(dataSource)) {
        throw new Error("Data source de Histórico de eventos incompleto");
      }
      const titleName = titlePropertyName(dataSource.properties);
      const dateName = datePropertyName(dataSource.properties);
      const existing = await this.findEventPageId(
        input.dataSourceId,
        input.title,
      );
      const pageId = existing
        ? await this.replaceEventPage(existing, dateName, input)
        : await this.createEventPage(titleName, dateName, input);
      const page = await this.getPage(pageId);
      if (!page.ok) {
        return page;
      }
      console.log("[NotionAdapter.createProjectEvent]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
      });
      return page;
    } catch (cause: unknown) {
      return this.fail("createProjectEvent", started, cause);
    }
  }

  async updateProjectTaskColumn(
    input: UpdateProjectTaskColumnInput,
  ): Promise<Result<NotionPage>> {
    const started = Date.now();
    try {
      const page = await this.client.pages.retrieve({ page_id: input.pageId });
      if (!isFullPage(page)) {
        throw new Error("Card de tarefa Notion incompleto");
      }
      const status = findStatusProperty(page.properties);
      if (!status) {
        throw new Error("Card de tarefa sem propriedade Status");
      }
      const updated = await this.client.pages.update({
        page_id: input.pageId,
        properties: {
          [status.name]:
            status.type === "status"
              ? { status: { name: input.column } }
              : { select: { name: input.column } },
        },
      });
      if (!isFullPage(updated)) {
        throw new Error("Card de tarefa Notion incompleto");
      }
      const mapped = toPage(updated);
      console.log("[NotionAdapter.updateProjectTaskColumn]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId: mapped.pageId,
        column: input.column,
      });
      return ok(mapped);
    } catch (cause: unknown) {
      return this.fail("updateProjectTaskColumn", started, cause);
    }
  }

  async markProjectInProgress(pageId: string): Promise<Result<NotionPage>> {
    const started = Date.now();
    try {
      await this.writeProjectInProgress(pageId, null);
      const page = await this.getPage(pageId);
      if (!page.ok) {
        return page;
      }
      console.log("[NotionAdapter.markProjectInProgress]", {
        ok: true,
        durationMs: Date.now() - started,
        pageId,
      });
      return page;
    } catch (cause: unknown) {
      return this.fail("markProjectInProgress", started, cause);
    }
  }

  private async createProjectPage(
    input: UpsertProjectPageInput,
  ): Promise<string> {
    const databaseId = requireNotionProjectsDbId();
    const status = input.markInProgress !== false
      ? NOTION_PROJECT_STATUS_IN_PROGRESS
      : NOTION_PROJECT_STATUS_NOT_STARTED;
    const properties: Record<
      string,
      | { title: Array<{ type: "text"; text: { content: string } }> }
      | { status: { name: string } }
      | { select: { name: string } }
    > = {
      "Nome do Projeto": {
        title: [{ type: "text", text: { content: input.title } }],
      },
      Status: { status: { name: status } },
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

  private async writeExistingProjectPage(
    pageId: string,
    input: UpsertProjectPageInput,
  ): Promise<string> {
    if (input.markInProgress !== false) {
      return this.writeProjectInProgress(pageId, input.select);
    }
    if (input.select) {
      await this.client.pages.update({
        page_id: pageId,
        properties: {
          Selecionar: { select: { name: input.select } },
        },
      });
    }
    return pageId;
  }

  private async writeProjectInProgress(
    pageId: string,
    select: UpsertProjectPageInput["select"],
  ): Promise<string> {
    const properties: Record<
      string,
      { status: { name: string } } | { select: { name: string } }
    > = {
      Status: { status: { name: NOTION_PROJECT_STATUS_IN_PROGRESS } },
    };
    if (select) {
      properties.Selecionar = { select: { name: select } };
    }
    await this.client.pages.update({ page_id: pageId, properties });
    return pageId;
  }

  private async findChildDatabaseId(
    pageId: string,
    title: string | readonly string[],
  ): Promise<string | null> {
    const titles = typeof title === "string" ? [title] : [...title];
    const blocks = await collectPaginatedAPI(this.client.blocks.children.list, {
      block_id: pageId,
    });
    const untitled: string[] = [];
    for (const block of blocks) {
      if (!isFullBlock(block) || block.type !== "child_database") {
        continue;
      }
      if (titles.includes(block.child_database.title)) {
        return block.id;
      }
      if (block.child_database.title.length === 0) {
        untitled.push(block.id);
      }
    }
    for (const databaseId of untitled) {
      const database = await this.client.databases.retrieve({
        database_id: databaseId,
      });
      const retrievedTitle = isFullDatabase(database)
        ? database.title.map((item) => item.plain_text).join("")
        : "";
      if (titles.includes(retrievedTitle)) {
        return databaseId;
      }
    }
    return null;
  }

  private async createEventsDatabase(pageId: string): Promise<string> {
    const created = await this.client.databases.create({
      parent: { type: "page_id", page_id: pageId },
      title: [{ type: "text", text: { content: NOTION_EVENTS_DB_TITLE } }],
      is_inline: true,
      initial_data_source: {
        properties: {
          Nome: { type: "title", title: {} },
          Quando: { type: "date", date: {} },
        },
      },
    });
    if (!isFullDatabase(created)) {
      throw new Error("Banco Histórico de eventos incompleto");
    }
    return created.id;
  }

  private async listDataSourceEvents(
    dataSourceId: string,
  ): Promise<ProjectEventCard[]> {
    const events: ProjectEventCard[] = [];
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
        events.push({
          pageId: result.id,
          title: readAnyTitle(result),
        });
      }
      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);
    return events;
  }

  private async findEventPageId(
    dataSourceId: string,
    title: string,
  ): Promise<string | null> {
    const events = await this.listDataSourceEvents(dataSourceId);
    return events.find((event) => event.title === title)?.pageId ?? null;
  }

  private async createEventPage(
    titleName: string,
    dateName: string | null,
    input: CreateProjectEventInput,
  ): Promise<string> {
    const properties: Record<string, unknown> = {
      [titleName]: {
        title: [{ type: "text", text: { content: input.title } }],
      },
    };
    if (dateName) {
      properties[dateName] = { date: { start: input.date } };
    }
    const created = await this.client.pages.create({
      parent: { data_source_id: input.dataSourceId },
      properties: properties as never,
      markdown: input.markdown,
    });
    return created.id;
  }

  private async replaceEventPage(
    pageId: string,
    dateName: string | null,
    input: CreateProjectEventInput,
  ): Promise<string> {
    if (dateName) {
      await this.client.pages.update({
        page_id: pageId,
        properties: {
          [dateName]: { date: { start: input.date } },
        },
      });
    }
    return this.replaceMarkdown(pageId, input.markdown);
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

  private async listDataSourceTasks(
    dataSourceId: string,
  ): Promise<ProjectTaskCard[]> {
    const tasks: ProjectTaskCard[] = [];
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
        const column = readKanbanColumn(result);
        if (!column) {
          continue;
        }
        tasks.push({
          pageId: result.id,
          title: readAnyTitle(result),
          column,
        });
      }
      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);
    return tasks;
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
    url: notionPageUrl(page.id),
    status: readProjectStatus(page),
  });
}

function readProjectStatus(page: PageObjectResponse): string | null {
  const property = page.properties.Status;
  if (!property || property.type !== "status") {
    return null;
  }
  return property.status?.name ?? null;
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

function datePropertyName(
  properties: Record<string, { type: string; name: string }>,
): string | null {
  for (const property of Object.values(properties)) {
    if (property.type === "date" && property.name === "Quando") {
      return property.name;
    }
  }
  for (const property of Object.values(properties)) {
    if (property.type === "date") {
      return property.name;
    }
  }
  return null;
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

function readKanbanColumn(page: PageObjectResponse): KanbanColumn | null {
  const status = findStatusProperty(page.properties);
  if (!status?.value) {
    return null;
  }
  const parsed = KanbanColumnSchema.safeParse(status.value);
  return parsed.success ? parsed.data : null;
}

function findStatusProperty(
  properties: PageObjectResponse["properties"],
): { name: string; type: "select" | "status"; value: string | null } | null {
  for (const [name, property] of Object.entries(properties)) {
    if (name !== "Status") {
      continue;
    }
    if (property.type === "select") {
      return {
        name,
        type: "select",
        value: property.select?.name ?? null,
      };
    }
    if (property.type === "status") {
      return {
        name,
        type: "status",
        value: property.status?.name ?? null,
      };
    }
  }
  for (const [name, property] of Object.entries(properties)) {
    if (property.type === "select") {
      return {
        name,
        type: "select",
        value: property.select?.name ?? null,
      };
    }
    if (property.type === "status") {
      return {
        name,
        type: "status",
        value: property.status?.name ?? null,
      };
    }
  }
  return null;
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
