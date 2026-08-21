import type { Result } from "../domain/result.js";
import type {
  NotionPage,
  UpcomingEventRecord,
  UpsertChildPageInput,
  UpsertUpcomingEventInput,
} from "../domain/schemas.js";

/**
 * Porta Notion. O domínio não importa `@notionhq/client`.
 */
export interface NotionPort {
  listDatabasePages(): Promise<Result<readonly NotionPage[]>>;
  getPage(pageId: string): Promise<Result<NotionPage>>;
  upsertChildPage(input: UpsertChildPageInput): Promise<Result<NotionPage>>;
  upsertUpcomingEvent(
    input: UpsertUpcomingEventInput,
  ): Promise<Result<UpcomingEventRecord>>;
  archiveUpcomingEvent(pageId: string): Promise<Result<void>>;
}

export type INotionPort = NotionPort;
