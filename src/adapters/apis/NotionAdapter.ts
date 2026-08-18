import "reflect-metadata";

import {
  APIErrorCode,
  Client,
  ClientErrorCode,
  extractDatabaseId,
  isFullDatabase,
  isFullPage,
  isNotionClientError,
  type PageObjectResponse,
  type QueryDataSourceParameters,
} from "@notionhq/client";
import { inject, injectable } from "inversify";

import { FRONT_CATALOG, PILAR_TO_FRONT } from "../../core/domain/catalog.js";
import { err, ok, type Result } from "../../core/domain/result.js";
import {
  DailyPlanPageSchema,
  DailyPlanSchema,
  KanbanCardSchema,
  NotionHubRefSchema,
  NotionSpecRefSchema,
  NotionSpecRowSchema,
  type DailyPlan,
  type DailyPlanPage,
  type FrontId,
  type IntegrationConfig,
  type IntegrationError,
  type KanbanCard,
  type KanbanMove,
  type NotionHubRef,
  type NotionSpecRef,
  type NotionSpecRow,
} from "../../core/domain/schemas.js";
import type { NotionPort } from "../../core/ports/NotionPort.js";
import { TOKENS } from "../../core/ports/tokens.js";

@injectable()
export class NotionAdapter implements NotionPort {
  private readonly client: Client;
  private readonly kanbanByDate = new Map<string, KanbanCard[]>();
  private readonly dailyPlans = new Map<string, DailyPlanPage>();
  private projectsDataSourceId: string | null = null;

  constructor(@inject(TOKENS.Config) config: IntegrationConfig) {
    this.client = new Client({
      auth: config.notionApiKey,
      timeoutMs: 15_000,
    });
  }

  async listActiveSpecs(
    front: FrontId | "all",
  ): Promise<Result<readonly NotionSpecRef[]>> {
    const started = Date.now();
    try {
      const rows = await this.getActiveProjects(front);
      const refs = rows.map((row) =>
        NotionSpecRefSchema.parse({
          pageId: row.pageId,
          title: row.name,
          url: row.url,
          cue: row.cue,
        }),
      );
      console.log("[NotionAdapter.listActiveSpecs]", {
        ok: true,
        durationMs: Date.now() - started,
        front,
        count: refs.length,
      });
      return ok(refs);
    } catch (cause: unknown) {
      return this.fail("listActiveSpecs", started, cause);
    }
  }

  async getSpecByCalendarSeries(
    seriesId: string,
  ): Promise<Result<NotionSpecRef>> {
    const started = Date.now();
    try {
      const rows = await this.getActiveProjects("all");
      const found = rows.find((row) =>
        row.calendarIds.some((id) => id === seriesId),
      );
      if (!found) {
        return err({
          provider: "notion",
          code: "not_found",
          message: `Spec para série ${seriesId} não encontrada`,
          retryable: false,
          retryAfterMs: null,
          cause: null,
        });
      }
      console.log("[NotionAdapter.getSpecByCalendarSeries]", {
        ok: true,
        durationMs: Date.now() - started,
        seriesId,
      });
      return ok(
        NotionSpecRefSchema.parse({
          pageId: found.pageId,
          title: found.name,
          url: found.url,
          cue: found.cue,
        }),
      );
    } catch (cause: unknown) {
      return this.fail("getSpecByCalendarSeries", started, cause);
    }
  }

  async listKanban(
    date: string,
    front: FrontId | "all",
  ): Promise<Result<readonly KanbanCard[]>> {
    console.log("[NotionAdapter.listKanban]", { date, front, mock: true });
    const cards = this.kanbanByDate.get(date) ?? [];
    this.kanbanByDate.set(date, cards);
    const filtered =
      front === "all" ? cards : cards.filter((card) => card.front === front);
    return ok(KanbanCardSchema.array().parse(filtered));
  }

  async applyKanbanMoves(
    date: string,
    moves: readonly KanbanMove[],
  ): Promise<Result<readonly KanbanCard[]>> {
    console.log("[NotionAdapter.applyKanbanMoves]", {
      date,
      moves: moves.length,
      mock: true,
    });

    const cards = [...(this.kanbanByDate.get(date) ?? [])];

    for (const move of moves) {
      const index = cards.findIndex((card) => card.id === move.cardId);
      if (index === -1) {
        return err({
          provider: "notion",
          code: "not_found",
          message: `Card ${move.cardId} não existe; Kanban não inventa card`,
          retryable: false,
          retryAfterMs: null,
          cause: null,
        });
      }
      const current = cards[index];
      if (!current) {
        continue;
      }
      cards[index] = KanbanCardSchema.parse({
        ...current,
        column: move.to,
        gtdActionId: move.gtdActionId,
      });
    }

    this.kanbanByDate.set(date, cards);
    return ok(KanbanCardSchema.array().parse(cards));
  }

  async upsertDailyPlan(plan: DailyPlan): Promise<Result<DailyPlanPage>> {
    const parsedPlan = DailyPlanSchema.parse(plan);
    console.log("[NotionAdapter.upsertDailyPlan]", {
      date: parsedPlan.date,
      mock: true,
    });

    const existing = this.dailyPlans.get(parsedPlan.date);
    const page = DailyPlanPageSchema.parse({
      pageId: existing?.pageId ?? `mock-daily-${parsedPlan.date}`,
      date: parsedPlan.date,
      url: `https://app.notion.com/p/mock-daily-${parsedPlan.date}`,
      blocksWritten: parsedPlan.blocks.length + parsedPlan.notes.length,
    });

    this.dailyPlans.set(parsedPlan.date, page);
    return ok(page);
  }

  async getHub(front: FrontId): Promise<Result<NotionHubRef>> {
    const catalog = FRONT_CATALOG[front];
    return ok(
      NotionHubRefSchema.parse({
        front,
        pageId: catalog.hubPageId,
        url: catalog.hubUrl,
      }),
    );
  }

  /**
   * Projetos ativos no banco Notion.
   * `Status` é propriedade nativa status; em andamento = `Em andamento`.
   */
  private async getActiveProjects(
    front: FrontId | "all",
  ): Promise<readonly NotionSpecRow[]> {
    const inProgress: QueryDataSourceParameters["filter"] = {
      property: "Status",
      status: { equals: "Em andamento" },
    };
    const filter: QueryDataSourceParameters["filter"] =
      front === "all"
        ? inProgress
        : {
            and: [
              inProgress,
              {
                property: "Pilar",
                select: { equals: pilarOf(front) },
              },
            ],
          };

    const dataSourceId = await this.resolveProjectsDataSourceId();
    const rows: NotionSpecRow[] = [];
    let cursor: string | null = null;

    do {
      const args: QueryDataSourceParameters = {
        data_source_id: dataSourceId,
        filter,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      };
      const page = await this.client.dataSources.query(args);
      for (const result of page.results) {
        if (!isFullPage(result)) {
          continue;
        }
        const row = toSpecRow(result);
        if (row) {
          rows.push(row);
        }
      }
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);

    return rows;
  }

  /**
   * Notion API v5 queryia data source, não database.
   * `NOTION_PROJECTS_DB_ID` é o ID do banco; daí sai o data_source_id.
   */
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

function pilarOf(front: FrontId): string {
  const entry = Object.entries(PILAR_TO_FRONT).find(
    ([, mapped]) => mapped === front,
  );
  return entry?.[0] ?? front;
}

function toSpecRow(page: PageObjectResponse): NotionSpecRow | null {
  const name = readTitle(page, "Nome");
  const status = readSelect(page, "Status");
  const prefixo = readSelect(page, "Prefixo");
  if (!name || (status !== "ativo" && status !== "rascunho")) {
    return null;
  }
  if (
    prefixo !== "SAUDE" &&
    prefixo !== "LAR" &&
    prefixo !== "INSTITUTO" &&
    prefixo !== "LOJA" &&
    prefixo !== "FAMILIA" &&
    prefixo !== "ENGENHARIA"
  ) {
    return null;
  }

  return NotionSpecRowSchema.parse({
    pageId: page.id,
    name,
    pilar: readSelect(page, "Pilar"),
    prefixo,
    slot: readText(page, "Slot"),
    calendarIds: parseCalendarIds(readText(page, "IDs Calendar")),
    cue: readText(page, "Cue").trim(),
    status,
    url: page.url,
  });
}

function readTitle(page: PageObjectResponse, name: string): string {
  const property = page.properties[name];
  if (!property || property.type !== "title") {
    return "";
  }
  return property.title.map((item) => item.plain_text).join("");
}

function readText(page: PageObjectResponse, name: string): string {
  const property = page.properties[name];
  if (!property) {
    return "";
  }
  if (property.type === "rich_text") {
    return property.rich_text.map((item) => item.plain_text).join("");
  }
  if (property.type === "title") {
    return property.title.map((item) => item.plain_text).join("");
  }
  return "";
}

function readSelect(page: PageObjectResponse, name: string): string {
  const property = page.properties[name];
  if (!property || property.type !== "select") {
    return "";
  }
  return property.select?.name ?? "";
}

function parseCalendarIds(raw: string): string[] {
  return raw
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 16);
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
