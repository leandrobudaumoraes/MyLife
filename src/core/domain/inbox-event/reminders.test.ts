import assert from "node:assert/strict";
import { test } from "node:test";

import type { TodoistReminder } from "../schemas.js";
import {
  calendarRemindersFor,
  isForceCreatePriority,
  remindersForPriority,
} from "./reminders.js";

const start = "2026-08-20T14:00:00-03:00";

test("P1 é priority 4 e força criação", () => {
  assert.equal(isForceCreatePriority(4), true);
  assert.equal(isForceCreatePriority(3), false);
  assert.equal(isForceCreatePriority(1), false);
});

test("sem lembrete na tarefa usa a tabela da prioridade", () => {
  assert.deepEqual(calendarRemindersFor(4, [], start), remindersForPriority(4));
  assert.deepEqual(remindersForPriority(2), [{ method: "popup", minutes: 30 }]);
});

test("lembrete relativo vira notificação com os mesmos minutos e canal", () => {
  const reminders: TodoistReminder[] = [
    {
      type: "relative",
      minuteOffset: 15,
      dueDatetime: null,
      service: "email",
    },
  ];
  assert.deepEqual(calendarRemindersFor(4, reminders, start), [
    { method: "email", minutes: 15 },
  ]);
});

test("lembrete push vira popup", () => {
  const reminders: TodoistReminder[] = [
    {
      type: "relative",
      minuteOffset: 10,
      dueDatetime: null,
      service: "push",
    },
  ];
  assert.deepEqual(calendarRemindersFor(1, reminders, start), [
    { method: "popup", minutes: 10 },
  ]);
});

test("lembrete absoluto vira minutos antes do início", () => {
  const reminders: TodoistReminder[] = [
    {
      type: "absolute",
      minuteOffset: null,
      dueDatetime: "2026-08-20T13:30:00-03:00",
      service: null,
    },
  ];
  assert.deepEqual(calendarRemindersFor(1, reminders, start), [
    { method: "popup", minutes: 30 },
  ]);
});
