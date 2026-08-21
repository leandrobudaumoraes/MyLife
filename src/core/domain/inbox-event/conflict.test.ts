import assert from "node:assert/strict";
import { test } from "node:test";

import type { CalendarEvent, TimeRange } from "../schemas.js";
import { conflictDetail, overlappingEvents, rangesOverlap, splitOverlappingEvents } from "./conflict.js";

const slot: TimeRange = {
  start: { iso: "2026-08-20T14:00:00-03:00" },
  end: { iso: "2026-08-20T15:00:00-03:00" },
};

test("intervalo que atravessa o slot é conflito", () => {
  const events = [
    event({
      eventId: "a",
      summary: "Reunião PagBank",
      range: {
        start: { iso: "2026-08-20T14:30:00-03:00" },
        end: { iso: "2026-08-20T15:30:00-03:00" },
      },
    }),
  ];
  const overlap = overlappingEvents(slot, events);
  assert.equal(overlap.length, 1);
  const detail = conflictDetail(overlap, slot);
  assert.match(detail, /Sua captura: 20\/08\/2026 14:00–15:00/);
  assert.match(detail, /Já existe neste horário/);
  assert.match(detail, /Reunião PagBank/);
  assert.match(detail, /20\/08\/2026 14:30–15:30/);
});

test("encostar no fim do anterior não é conflito", () => {
  const events = [
    event({
      range: {
        start: { iso: "2026-08-20T13:00:00-03:00" },
        end: { iso: "2026-08-20T14:00:00-03:00" },
      },
    }),
  ];
  assert.equal(overlappingEvents(slot, events).length, 0);
  assert.equal(rangesOverlap(slot, events[0]!.range), false);
});

test("dia inteiro não conta como conflito", () => {
  const events = [
    event({
      allDay: true,
      range: {
        start: { iso: "2026-08-20T00:00:00-03:00" },
        end: { iso: "2026-08-21T00:00:00-03:00" },
      },
    }),
  ];
  assert.equal(overlappingEvents(slot, events).length, 0);
});

test("ignora o próprio evento ao reprocessar", () => {
  const events = [
    event({
      eventId: "self",
      range: slot,
    }),
  ];
  assert.equal(overlappingEvents(slot, events, "self").length, 0);
  assert.equal(overlappingEvents(slot, events).length, 1);
});

test("evento desta captura não conta como conflito estrangeiro", () => {
  const events = [
    event({
      eventId: "self",
      summary: "Vento 2",
      description: "Briefing: https://www.notion.so/3c2f94d816108143af5ffcf5599fba5d",
      range: slot,
    }),
    event({
      eventId: "busy",
      summary: "Reunião PagBank",
      range: {
        start: { iso: "2026-08-20T14:30:00-03:00" },
        end: { iso: "2026-08-20T15:30:00-03:00" },
      },
    }),
  ];
  const split = splitOverlappingEvents(slot, events);
  assert.deepEqual(
    split.own.map((item) => item.eventId),
    ["self"],
  );
  assert.deepEqual(
    split.foreign.map((item) => item.eventId),
    ["busy"],
  );
});

test("mesmo título e horário sem Briefing é conflito de terceiro", () => {
  const events = [
    event({
      eventId: "smile",
      summary: "Dentista Smile",
      description: null,
      range: slot,
    }),
  ];
  const split = splitOverlappingEvents(slot, events);
  assert.deepEqual(split.own.map((item) => item.eventId), []);
  assert.deepEqual(split.foreign.map((item) => item.eventId), ["smile"]);
});

test("Briefing em HTML ainda identifica o evento desta captura", () => {
  const events = [
    event({
      eventId: "self",
      summary: "Vento 2",
      description:
        '<html>Briefing: <a href="https://www.notion.so/3c2f94d816108143af5ffcf5599fba5d">link</a></html>',
      range: slot,
    }),
  ];
  const split = splitOverlappingEvents(slot, events);
  assert.deepEqual(split.own.map((item) => item.eventId), ["self"]);
  assert.equal(split.foreign.length, 0);
});

test("13:00 de um dia não conflita com 12:45 do dia seguinte", () => {
  const friday: TimeRange = {
    start: { iso: "2026-08-21T13:00:00-03:00" },
    end: { iso: "2026-08-21T14:00:00-03:00" },
  };
  const saturday: TimeRange = {
    start: { iso: "2026-08-22T13:00:00-03:00" },
    end: { iso: "2026-08-22T14:00:00-03:00" },
  };
  const nutritionist = event({
    summary: "Agenda com nutricionista",
    range: {
      start: { iso: "2026-08-21T12:45:00-03:00" },
      end: { iso: "2026-08-21T13:45:00-03:00" },
    },
  });
  assert.equal(overlappingEvents(friday, [nutritionist]).length, 1);
  assert.equal(overlappingEvents(saturday, [nutritionist]).length, 0);
});

function event(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    eventId: "evt",
    calendarId: "primary",
    summary: "Evento",
    range: slot,
    htmlLink: "https://www.google.com/calendar/event?eid=abc",
    allDay: false,
    description: null,
    ...partial,
  };
}
