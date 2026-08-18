import "reflect-metadata";

import { google, type calendar_v3 } from "googleapis";
import { inject, injectable } from "inversify";

import {
  assertNotProtectedWrite,
  PROTECTED_SERIES_IDS,
  PROTECTED_SERIES_PREFIX,
  type ProtectedSeriesCatalog,
} from "../../core/domain/catalog.js";
import { err, ok, type Result } from "../../core/domain/result.js";
import {
  CalendarEventRefSchema,
  type BusyQuery,
  type CalendarEventRef,
  type DeleteOccurrenceInput,
  type IntegrationConfig,
  type UpsertFlexEventInput,
} from "../../core/domain/schemas.js";
import type { CalendarPort } from "../../core/ports/CalendarPort.js";
import { TOKENS } from "../../core/ports/tokens.js";

@injectable()
export class CalendarAdapter implements CalendarPort {
  private readonly calendar: calendar_v3.Calendar;
  private readonly primaryCalendarId: string;
  private readonly institutoCalendarId: string;
  private readonly catalog: ProtectedSeriesCatalog;
  private readonly flexByKey = new Map<string, CalendarEventRef>();
  private readonly deletedOccurrenceIds = new Set<string>();

  constructor(
    @inject(TOKENS.Config) config: IntegrationConfig,
    @inject(TOKENS.ProtectedSeries) catalog: ProtectedSeriesCatalog,
  ) {
    this.calendar = google.calendar({ version: "v3" });
    this.primaryCalendarId = config.googleCalendarId;
    this.institutoCalendarId = config.googleCalendarInstitutoId;
    this.catalog = catalog;
  }

  async listBusy(
    query: BusyQuery,
  ): Promise<Result<readonly CalendarEventRef[]>> {
    console.log("[CalendarAdapter.listBusy]", {
      sdk: "googleapis.calendar.v3",
      eventsResource: typeof this.calendar.events,
      query,
    });

    const protectedSlots = mockProtectedOccurrences(
      query.date,
      this.primaryCalendarId,
    );
    const flex = [...this.flexByKey.values()].filter((event) =>
      event.range.start.iso.startsWith(query.date),
    );

    const events = [...protectedSlots, ...flex].filter(
      (event) =>
        query.calendarIds.includes(event.calendarId) &&
        !this.deletedOccurrenceIds.has(event.eventId),
    );

    return ok(CalendarEventRefSchema.array().parse(events));
  }

  async listProtectedOccurrences(
    date: string,
  ): Promise<Result<readonly CalendarEventRef[]>> {
    console.log("[CalendarAdapter.listProtectedOccurrences]", { date });
    const events = mockProtectedOccurrences(date, this.primaryCalendarId).filter(
      (event) => !this.deletedOccurrenceIds.has(event.eventId),
    );
    return ok(CalendarEventRefSchema.array().parse(events));
  }

  async upsertFlexEvent(
    input: UpsertFlexEventInput,
  ): Promise<Result<CalendarEventRef>> {
    console.log("[CalendarAdapter.upsertFlexEvent]", {
      lifeOsKey: input.lifeOsKey,
    });

    const existing = this.flexByKey.get(input.lifeOsKey);
    try {
      assertNotProtectedWrite(existing?.seriesId ?? null);
    } catch (cause: unknown) {
      return err({
        provider: "google_calendar",
        code: "forbidden_write",
        message:
          cause && typeof cause === "object" && "message" in cause
            ? String(cause.message)
            : "Write em série protegida é proibido",
        retryable: false,
        retryAfterMs: null,
        cause,
      });
    }

    const event = CalendarEventRefSchema.parse({
      eventId: existing?.eventId ?? `flex-${input.lifeOsKey}`,
      calendarId: this.primaryCalendarId,
      seriesId: null,
      prefix: input.prefix,
      summary: input.title,
      range: input.range,
      protectedSlot: false,
      specUrl: input.specUrl,
      cue: input.cue,
    });

    this.flexByKey.set(input.lifeOsKey, event);
    return ok(event);
  }

  async deleteOccurrence(
    input: DeleteOccurrenceInput,
  ): Promise<Result<void>> {
    console.log("[CalendarAdapter.deleteOccurrence]", input);

    const seriesId = seriesIdFromOccurrence(input.eventId);
    if (seriesId && this.catalog.isProtectedSeries(seriesId)) {
      // Exceção autorizada: apaga ocorrência, não a série.
      this.deletedOccurrenceIds.add(input.eventId);
      return ok(undefined);
    }

    for (const [key, event] of this.flexByKey) {
      if (event.eventId === input.eventId) {
        this.flexByKey.delete(key);
        this.deletedOccurrenceIds.add(input.eventId);
        return ok(undefined);
      }
    }

    return err({
      provider: "google_calendar",
      code: "not_found",
      message: `Ocorrência ${input.eventId} não encontrada`,
      retryable: false,
      retryAfterMs: null,
      cause: null,
    });
  }

  async listInstitutoRites(
    date: string,
  ): Promise<Result<readonly CalendarEventRef[]>> {
    console.log("[CalendarAdapter.listInstitutoRites]", {
      date,
      calendarId: this.institutoCalendarId,
    });
    return ok([]);
  }
}

function seriesIdFromOccurrence(eventId: string): string | null {
  const match = /^occ-(.+)-\d{4}-\d{2}-\d{2}$/.exec(eventId);
  return match?.[1] ?? null;
}

function mockProtectedOccurrences(
  date: string,
  calendarId: string,
): CalendarEventRef[] {
  const slots: ReadonlyArray<{
    seriesId: string;
    summary: string;
    start: string;
    end: string;
  }> = [
    {
      seriesId: "u9bgqekrb6isudq7ntug21034g",
      summary: "FAMILIA - Casa (Arthur e saída)",
      start: "06:00:00",
      end: "07:05:00",
    },
    {
      seriesId: "kms19pgudaa844m142nfs36d8s",
      summary: "FAMILIA - Escola Inovação",
      start: "07:15:00",
      end: "07:45:00",
    },
    {
      seriesId: "u7bka3nff46blrfphjc52pfiq0",
      summary: "SAUDE - Zone 2",
      start: "07:50:00",
      end: "08:20:00",
    },
    {
      seriesId: "eg997v16e5ersn8b45gkpkcjn4",
      summary: "ENGENHARIA - PagBank coordenação",
      start: "09:00:00",
      end: "12:00:00",
    },
    {
      seriesId: "aedkngskr8pvsik5qm3a8a2k9o",
      summary: "SAUDE - Almoço",
      start: "12:00:00",
      end: "13:00:00",
    },
    {
      seriesId: "0em2de2hu11j5e4qnvafsobioo",
      summary: "ENGENHARIA - PagBank engenharia",
      start: "13:00:00",
      end: "18:00:00",
    },
  ];

  return slots.map((slot) => {
    const prefix = PROTECTED_SERIES_PREFIX[slot.seriesId] ?? "SAUDE";

    return CalendarEventRefSchema.parse({
      eventId: `occ-${slot.seriesId}-${date}`,
      calendarId,
      seriesId: slot.seriesId,
      prefix,
      summary: slot.summary,
      range: {
        start: { iso: `${date}T${slot.start}-03:00` },
        end: { iso: `${date}T${slot.end}-03:00` },
      },
      protectedSlot: PROTECTED_SERIES_IDS.includes(slot.seriesId),
      specUrl: null,
      cue: null,
    });
  });
}
