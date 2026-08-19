import type { Result } from "../domain/result.js";
import type {
  CreateProjectTaskInput,
  NotionPage,
  ProjectTaskBoard,
  UpsertChildPageInput,
  UpsertProjectPageInput,
} from "../domain/schemas.js";

/**
 * Porta Notion. O domínio não importa `@notionhq/client`.
 */
export interface NotionPort {
  listDatabasePages(): Promise<Result<readonly NotionPage[]>>;
  getPage(pageId: string): Promise<Result<NotionPage>>;
  upsertChildPage(input: UpsertChildPageInput): Promise<Result<NotionPage>>;
  upsertProjectPage(
    input: UpsertProjectPageInput,
  ): Promise<Result<NotionPage>>;
  ensureProjectTaskBoard(pageId: string): Promise<Result<ProjectTaskBoard>>;
  createProjectTask(input: CreateProjectTaskInput): Promise<Result<NotionPage>>;
}

export type INotionPort = NotionPort;
