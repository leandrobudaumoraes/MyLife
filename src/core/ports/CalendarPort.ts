import type { Result } from "../domain/result.js";
import type {
  BusyQuery,
  CalendarEventRef,
  DeleteOccurrenceInput,
  UpsertFlexEventInput,
} from "../domain/schemas.js";

/**
 * Porta do relógio (Google Calendar).
 * `upsertFlexEvent` cria/atualiza timeblocks flex. Nunca PATCH de série protegida.
 */
export interface CalendarPort {
  listBusy(query: BusyQuery): Promise<Result<readonly CalendarEventRef[]>>;

  listProtectedOccurrences(
    date: string,
  ): Promise<Result<readonly CalendarEventRef[]>>;

  /**
   * Cria ou atualiza bloco flex (timeblocking).
   * Nunca PATCH em `recurringEventId` de série protegida.
   */
  upsertFlexEvent(
    input: UpsertFlexEventInput,
  ): Promise<Result<CalendarEventRef>>;

  /**
   * Apaga UMA ocorrência. Proibido delete da série.
   * v0.1: só exceção explícita (plantão / rito / Smile).
   */
  deleteOccurrence(input: DeleteOccurrenceInput): Promise<Result<void>>;

  /** Listar ritos no calendário Instituto (busy). Sem write. */
  listInstitutoRites(
    date: string,
  ): Promise<Result<readonly CalendarEventRef[]>>;
}

/** Alias do contrato em `01-api-integrations.md`. */
export type IGoogleCalendarPort = CalendarPort;
