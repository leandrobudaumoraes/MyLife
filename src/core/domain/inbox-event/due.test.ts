import assert from "node:assert/strict";
import { test } from "node:test";

import { inspectDue, pendenciaComment } from "./due.js";

test("sem data bloqueia com falta de data e hora", () => {
  const due = inspectDue({ dueDate: null, dueDatetime: null });
  assert.equal(due.ok, false);
  if (!due.ok) {
    assert.equal(due.missing, "date_and_time");
  }
});

test("data sem hora bloqueia pedindo horário", () => {
  const due = inspectDue({
    dueDate: "2026-08-20",
    dueDatetime: null,
  });
  assert.equal(due.ok, false);
  if (!due.ok) {
    assert.equal(due.missing, "time");
    assert.match(due.detail, /20\/08\/2026/);
  }
});

test("datetime vira ISO civil com fuso de São Paulo", () => {
  const due = inspectDue({
    dueDate: "2026-08-20",
    dueDatetime: "2026-08-20T14:00:00",
  });
  assert.equal(due.ok, true);
  if (due.ok) {
    assert.equal(due.startIso, "2026-08-20T14:00:00-03:00");
  }
});

test("comentário de pendencia diz o que falta e como corrigir", () => {
  const comment = pendenciaComment("Falta horário. Data atual: 20/08/2026.");
  assert.match(comment, /nada foi gravado/i);
  assert.match(comment, /remova a etiqueta Pending/);
});
