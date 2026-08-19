import assert from "node:assert/strict";
import { test } from "node:test";

import {
  doingOnly,
  forceSingleDoing,
  isUsableProjectPlan,
  limitPlannedTasks,
  normalizeProjectSelect,
  pickNextDoing,
  ProjectPlanSchema,
} from "./projectPlan.js";

test("força exatamente uma DOING", () => {
  const forced = forceSingleDoing([
    { title: "A", column: "BACKLOG" },
    { title: "B", column: "TO DO" },
  ]);
  assert.equal(forced.filter((task) => task.column === "DOING").length, 1);
  assert.equal(forced[0]?.column, "DOING");
});

test("segunda DOING vira TO DO", () => {
  const forced = forceSingleDoing([
    { title: "A", column: "DOING" },
    { title: "B", column: "DOING" },
  ]);
  assert.deepEqual(forced.map((task) => task.column), ["DOING", "TO DO"]);
});

test("desta corrida o Todoist só pega a DOING", () => {
  const doing = doingOnly([
    { title: "A", column: "BACKLOG" },
    { title: "B", column: "DOING" },
    { title: "C", column: "TO DO" },
  ]);
  assert.deepEqual(doing, { title: "B", column: "DOING" });
});

test("teto de 7 preserva a DOING no quadro Notion", () => {
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    title: `T${index}`,
    column: index === 3 ? ("DOING" as const) : ("BACKLOG" as const),
  }));
  const limited = limitPlannedTasks(tasks);
  assert.equal(limited.length, 7);
  assert.equal(limited[0]?.column, "DOING");
});

test("nome reservado não é plano usável", () => {
  assert.equal(
    isUsableProjectPlan({
      insufficient: false,
      projectName: "🩺 Saúde",
      select: "Pessoal",
      doingLabels: [],
      tasks: [{ title: "Ligar", column: "DOING" }],
    }),
    false,
  );
});

test("select nulo ou omitido vira Pessoal", () => {
  assert.equal(normalizeProjectSelect(null), "Pessoal");
  assert.equal(normalizeProjectSelect(undefined), "Pessoal");
  assert.equal(
    ProjectPlanSchema.parse({
      insufficient: false,
      projectName: "Curso de IA",
      select: null,
      tasks: [{ title: "Listar módulos", column: "DOING" }],
    }).select,
    "Pessoal",
  );
});

test("select aceita alias de pilar e acento", () => {
  assert.equal(normalizeProjectSelect("Família"), "Familia");
  assert.equal(normalizeProjectSelect("👨 Família"), "Familia");
  assert.equal(normalizeProjectSelect("🌙 Loja Lua Branca"), "Loja");
  assert.equal(normalizeProjectSelect("💰 Financeiro"), "Casa");
  assert.equal(normalizeProjectSelect("Instituto Metatron"), "Instituto");
  assert.equal(normalizeProjectSelect("Engenharia e IA"), "Pessoal");
});

test("sem DOING promove a primeira TO DO", () => {
  const next = pickNextDoing([
    { title: "A", column: "BACKLOG" as const },
    { title: "B", column: "TO DO" as const },
    { title: "C", column: "DONE" as const },
  ]);
  assert.deepEqual(next, { title: "B", column: "TO DO" });
});

test("sem TO DO promove BACKLOG", () => {
  const next = pickNextDoing([
    { title: "A", column: "DONE" as const },
    { title: "B", column: "BACKLOG" as const },
  ]);
  assert.deepEqual(next, { title: "B", column: "BACKLOG" });
});

test("com DOING ainda promove a TO DO (conclusão no Todoist fecha a DOING depois)", () => {
  assert.deepEqual(
    pickNextDoing([
      { title: "A", column: "DOING" as const },
      { title: "B", column: "TO DO" as const },
    ]),
    { title: "B", column: "TO DO" },
  );
});

test("só DONE não promove", () => {
  assert.equal(
    pickNextDoing([{ title: "A", column: "DONE" as const }]),
    null,
  );
});
