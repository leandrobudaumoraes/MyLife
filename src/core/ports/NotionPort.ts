import type { Result } from "../domain/result.js";
import type {
  CreateProjectTaskInput,
  NotionPage,
  ProjectTaskBoard,
  UpdateProjectTaskColumnInput,
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
  markProjectInProgress(pageId: string): Promise<Result<NotionPage>>;
  ensureProjectTaskBoard(pageId: string): Promise<Result<ProjectTaskBoard>>;
  findProjectTaskBoard(
    pageId: string,
  ): Promise<Result<ProjectTaskBoard | null>>;
  createProjectTask(input: CreateProjectTaskInput): Promise<Result<NotionPage>>;
  updateProjectTaskColumn(
    input: UpdateProjectTaskColumnInput,
  ): Promise<Result<NotionPage>>;
}

export type INotionPort = NotionPort;
