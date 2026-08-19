import assert from "node:assert/strict";
import { test } from "node:test";

import { err, ok } from "./result.js";

test("ok envolve o valor", () => {
  const result = ok(1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, 1);
  }
});

test("err envolve o erro", () => {
  const result = err({
    provider: "llm",
    code: "unavailable",
    message: "falha",
    retryable: true,
    retryAfterMs: 400,
    cause: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.provider, "llm");
  }
});
