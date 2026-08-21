import assert from "node:assert/strict";
import { test } from "node:test";

import { civilDateOfIso, civilIsoFromGoogleDateTime, sameInstant, toNotionWallClock, toUtcIso } from "./clock.js";

test("civil de São Paulo vira UTC Z", () => {
  assert.equal(toUtcIso("2026-08-20T14:00:00-03:00"), "2026-08-20T17:00:00.000Z");
});

test("Notion recebe relógio de parede, não o instant Z", () => {
  assert.equal(
    toNotionWallClock("2026-08-20T14:00:00-03:00"),
    "2026-08-20T14:00:00",
  );
});

test("mesmo instante casa offset, Z e relógio ingênuo de São Paulo", () => {
  assert.equal(
    sameInstant("2026-08-20T17:00:00.000Z", "2026-08-20T14:00:00-03:00"),
    true,
  );
  assert.equal(
    sameInstant("2026-08-20T14:00:00.000-03:00", "2026-08-20T14:00:00-03:00"),
    true,
  );
  assert.equal(
    sameInstant("2026-08-20T14:00:00.000", "2026-08-20T14:00:00-03:00"),
    true,
  );
  assert.equal(
    sameInstant("2026-08-20T20:00:00.000Z", "2026-08-20T14:00:00-03:00"),
    false,
  );
});

test("ISO em UTC vira o dia civil de São Paulo", () => {
  assert.equal(civilDateOfIso("2026-08-21T16:00:00Z"), "2026-08-21");
  assert.equal(civilDateOfIso("2026-08-22T02:00:00Z"), "2026-08-21");
});

test("dateTime do Google sem offset respeita timeZone UTC", () => {
  assert.equal(
    civilIsoFromGoogleDateTime("2026-08-21T15:45:00", "UTC"),
    "2026-08-21T12:45:00-03:00",
  );
  assert.equal(
    civilIsoFromGoogleDateTime("2026-08-21T12:45:00-03:00", "UTC"),
    "2026-08-21T12:45:00-03:00",
  );
  assert.equal(
    civilIsoFromGoogleDateTime("2026-08-21T12:45:00", "America/Sao_Paulo"),
    "2026-08-21T12:45:00-03:00",
  );
});
