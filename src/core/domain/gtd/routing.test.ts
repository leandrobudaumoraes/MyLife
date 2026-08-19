import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyRouting, stripRoutingLabels } from "./routing.js";

test("Inbox sem etiqueta de roteamento fica parada", () => {
  assert.deepEqual(classifyRouting(["Casa"]), {
    kind: "skip",
    reason: "none",
  });
});

test("Project sozinho dispara o caminho de projeto", () => {
  assert.deepEqual(classifyRouting(["Project", "Casa"]), { kind: "Project" });
});

test("Event sozinho dispara o caminho de evento", () => {
  assert.deepEqual(classifyRouting(["Event", "Casa"]), { kind: "Event" });
});

test("duas etiquetas de roteamento são ambíguas", () => {
  assert.deepEqual(classifyRouting(["Next", "Project"]), {
    kind: "skip",
    reason: "ambiguous",
  });
});

test("strip tira só o roteamento", () => {
  assert.deepEqual(stripRoutingLabels(["Project", "Casa", "Doing"]), [
    "Casa",
    "Doing",
  ]);
});
