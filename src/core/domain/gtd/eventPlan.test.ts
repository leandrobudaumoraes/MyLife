import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conflictWindow,
  expandOccurrences,
  findConflict,
  resolveEventSlot,
} from "./eventPlan.js";
import type { CalendarEvent } from "../schemas.js";

test("sem dia ou hora o slot não é usável", () => {
  assert.equal(
    resolveEventSlot({
      insufficient: true,
      start: null,
      end: null,
      recurrence: null,
    }),
    null,
  );
  assert.equal(
    resolveEventSlot({
      insufficient: false,
      start: null,
      end: null,
      recurrence: null,
    }),
    null,
  );
});

test("só hora de início vira 60 minutos", () => {
  const resolved = resolveEventSlot({
    insufficient: false,
    start: "2026-08-20T10:00:00-03:00",
    end: null,
    recurrence: null,
  });
  assert.equal(resolved?.range.end.iso, "2026-08-20T11:00:00-03:00");
});

test("série diária olha 14 dias à frente", () => {
  const range = {
    start: { iso: "2026-08-20T10:00:00-03:00" },
    end: { iso: "2026-08-20T11:00:00-03:00" },
  };
  const window = conflictWindow(range, true);
  assert.deepEqual(window, { from: "2026-08-20", until: "2026-09-03" });
  const occurrences = expandOccurrences(range, {
    freq: "DAILY",
    interval: 1,
    byDay: [],
    until: null,
  });
  assert.equal(occurrences.length, 15);
  assert.equal(occurrences[2]?.start.iso, "2026-08-22T10:00:00-03:00");
});

test("intervalo [início, fim) não conflita no instante do fim", () => {
  const conflict = findConflict(
    [
      {
        start: { iso: "2026-08-20T10:00:00-03:00" },
        end: { iso: "2026-08-20T11:00:00-03:00" },
      },
    ],
    [
      event({
        start: "2026-08-20T09:00:00-03:00",
        end: "2026-08-20T10:00:00-03:00",
      }),
    ],
  );
  assert.equal(conflict, null);
});

test("dia inteiro não entra no conflito", () => {
  const conflict = findConflict(
    [
      {
        start: { iso: "2026-08-20T10:00:00-03:00" },
        end: { iso: "2026-08-20T11:00:00-03:00" },
      },
    ],
    [
      event({
        start: "2026-08-20T00:00:00-03:00",
        end: "2026-08-21T00:00:00-03:00",
        allDay: true,
        summary: "Feriado",
      }),
    ],
  );
  assert.equal(conflict, null);
});

function event(input: {
  readonly start: string;
  readonly end: string;
  readonly allDay?: boolean;
  readonly summary?: string;
}): CalendarEvent {
  return {
    eventId: "e1",
    calendarId: "gmail",
    summary: input.summary ?? "Busy",
    range: {
      start: { iso: input.start },
      end: { iso: input.end },
    },
    htmlLink: null,
    allDay: input.allDay ?? false,
  };
}
