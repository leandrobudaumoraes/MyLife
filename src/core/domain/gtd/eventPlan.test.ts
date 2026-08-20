import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calendarEventBody,
  conflictWindow,
  expandOccurrences,
  findConflict,
  hydrateEventPage,
  isUsableEventProject,
  parseCaptureEventSlot,
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

test("domingo as 18:00 na quarta vira o próximo domingo", () => {
  const resolved = parseCaptureEventSlot(
    "Discussão sobre a viagem a PERU\ndomingo as 18:00",
    "2026-08-19",
  );
  assert.equal(resolved?.range.start.iso, "2026-08-23T18:00:00-03:00");
  assert.equal(resolved?.range.end.iso, "2026-08-23T19:00:00-03:00");
  assert.equal(resolved?.recurrence, null);
});

test("todo domingo as 18:00 vira série semanal", () => {
  const resolved = parseCaptureEventSlot("todo domingo as 18:00", "2026-08-19");
  assert.equal(resolved?.range.start.iso, "2026-08-23T18:00:00-03:00");
  assert.equal(resolved?.recurrence?.freq, "WEEKLY");
  assert.deepEqual(resolved?.recurrence?.byDay, ["SU"]);
});

test("amanhã, hoje, ontem e depois de amanhã resolvem a data", () => {
  assert.equal(
    parseCaptureEventSlot("Consulta amanhã às 18:00", "2026-08-19")?.range.start
      .iso,
    "2026-08-20T18:00:00-03:00",
  );
  assert.equal(
    parseCaptureEventSlot("hoje as 10", "2026-08-19")?.range.start.iso,
    "2026-08-19T10:00:00-03:00",
  );
  assert.equal(
    parseCaptureEventSlot("ontem as 15h", "2026-08-19")?.range.start.iso,
    "2026-08-18T15:00:00-03:00",
  );
  assert.equal(
    parseCaptureEventSlot("depois de amanhã as 9h", "2026-08-19")?.range.start
      .iso,
    "2026-08-21T09:00:00-03:00",
  );
});

test("segunda, sexta-feira e 18h sozinho usam o relógio do Todoist", () => {
  assert.equal(
    parseCaptureEventSlot("Reunião segunda as 9:00", "2026-08-19")?.range.start
      .iso,
    "2026-08-24T09:00:00-03:00",
  );
  assert.equal(
    parseCaptureEventSlot("Sex @ 19h", "2026-08-19")?.range.start.iso,
    "2026-08-21T19:00:00-03:00",
  );
  assert.equal(
    parseCaptureEventSlot("18h", "2026-08-19")?.range.start.iso,
    "2026-08-19T18:00:00-03:00",
  );
  assert.equal(
    parseCaptureEventSlot("amanhã de manhã", "2026-08-19")?.range.start.iso,
    "2026-08-20T09:00:00-03:00",
  );
});

test("em 5 dias, 27/08 e 27 ago viram data civil", () => {
  assert.equal(
    parseCaptureEventSlot("em 5 dias as 14h", "2026-08-19")?.range.start.iso,
    "2026-08-24T14:00:00-03:00",
  );
  assert.equal(
    parseCaptureEventSlot("27/08 as 18:00", "2026-08-19")?.range.start.iso,
    "2026-08-27T18:00:00-03:00",
  );
  assert.equal(
    parseCaptureEventSlot("27 ago as 18h", "2026-08-19")?.range.start.iso,
    "2026-08-27T18:00:00-03:00",
  );
});

test("sem hora o Event não resolve, mesmo com amanhã", () => {
  assert.equal(parseCaptureEventSlot("consulta amanhã", "2026-08-19"), null);
  assert.equal(parseCaptureEventSlot("domingo", "2026-08-19"), null);
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

test("cue + passos viram HTML curto no Calendar", () => {
  const body = calendarEventBody({
    cue: "22:00: nardirin, dentes, dipirona. Luz apagada.",
    steps: ["Tomar nardirin", "Escovar os dentes", "Tomar dipirona 5g"],
    specUrl: "https://notion.so/ao-dormir",
    specTitle: "Ao dormir",
  });
  assert.match(body, /<b>Cue:<\/b> 22:00: nardirin/);
  assert.match(body, /1\. Tomar nardirin/);
  assert.match(body, /<b>Spec:<\/b> <a href="https:\/\/notion.so\/ao-dormir">Ao dormir<\/a>/);
});

test("página do evento reusa o projeto e não aceita nome de pilar", () => {
  const slot = {
    insufficient: false,
    start: "2026-08-19T22:00:00-03:00",
    end: "2026-08-20T06:00:00-03:00",
    recurrence: { freq: "DAILY" as const, interval: 1, byDay: [], until: null },
    projectName: "Melhorar o sono",
    select: "Pessoal" as const,
    pageTitle: "",
    cue: "22:00: nardirin, dentes, dipirona. Luz apagada.",
    markdown: "",
    steps: ["Tomar nardirin", "Escovar os dentes"],
  };
  const page = hydrateEventPage(
    slot,
    { content: "Ao dormir", description: "Acontecerá todo dia as 22:00." },
    ["Usar nardirin"],
  );
  assert.equal(page?.projectName, "Melhorar o sono");
  assert.equal(page?.pageTitle, "Ao dormir");
  assert.match(page?.markdown ?? "", /## Agora/);
  assert.equal(isUsableEventProject("🩺 Saúde"), false);
  assert.equal(isUsableEventProject(""), false);
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
