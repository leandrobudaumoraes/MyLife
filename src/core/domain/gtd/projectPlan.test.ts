import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forceSingleDoing,
  isUsableProjectPlan,
  limitPlannedTasks,
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

test("teto de 7 preserva a DOING", () => {
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
      select: null,
      doingLabels: [],
      tasks: [{ title: "Ligar", column: "DOING" }],
    }),
    false,
  );
});
