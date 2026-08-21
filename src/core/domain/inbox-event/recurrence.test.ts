import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRecurrence, recurrenceLabelOf } from "./recurrence.js";

test("todo dia 15 vira MONTHLY BYMONTHDAY", () => {
  const parsed = parseRecurrence("todo dia 15");
  assert.ok(parsed);
  assert.equal(parsed?.freq, "MONTHLY");
  assert.equal(parsed?.byMonthDay, 15);
  assert.equal(recurrenceLabelOf("todo dia 15", parsed), "todo dia 15");
});

test("toda terça vira WEEKLY", () => {
  const parsed = parseRecurrence("toda terça 14:00");
  assert.ok(parsed);
  assert.equal(parsed?.freq, "WEEKLY");
  assert.deepEqual(parsed?.byDay, ["TU"]);
});

test("todos os dias vira DAILY", () => {
  const parsed = parseRecurrence("todos os dias");
  assert.ok(parsed);
  assert.equal(parsed?.freq, "DAILY");
});

test("avulso sem texto recorrente retorna null", () => {
  assert.equal(parseRecurrence("20 ago 14:00"), null);
});
