import assert from "node:assert/strict";
import { test } from "node:test";

import {
  casaActionEligibleToday,
  casaFlexThreshold,
  estimateCasaDurationMs,
  parseProposalInstant,
  resolveCasaFlexRange,
  sanitizeProposalCopy,
  stripLegacySchedulePrefix,
  selectCasaFallbackAction,
} from "./proposal-guard.js";
import {
  COMMON_RULES,
  SPECIALIST_SYSTEM_PROMPTS,
} from "./specialist-prompts.js";
import type { GtdAction, TimeRange } from "../schemas.js";

const TUESDAY = "2026-08-18";
const SATURDAY = "2026-08-22";

function wouldBeSchemaInvalid(date: string, range: TimeRange): boolean {
  const startMs = Date.parse(range.start.iso);
  const endMs = Date.parse(range.end.iso);
  return (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    startMs >= endMs ||
    !range.start.iso.startsWith(date)
  );
}

function weekdayGaps(): TimeRange[] {
  return [
    {
      start: { iso: `${TUESDAY}T08:20:00-03:00` },
      end: { iso: `${TUESDAY}T09:00:00-03:00` },
    },
    {
      start: { iso: `${TUESDAY}T20:00:00-03:00` },
      end: { iso: `${TUESDAY}T22:00:00-03:00` },
    },
  ];
}

test("prompt da Casa não carrega o exemplo legado Sáb 14:00 / Sair. Uma loja", () => {
  const casa = SPECIALIST_SYSTEM_PROMPTS.infraestrutura_casa;
  assert.equal(casa.includes("Sáb 14:00"), false);
  assert.equal(casa.includes("Sair. Uma loja"), false);
  assert.match(casa, /Fidelidade semântica/);
  assert.match(casa, /DATE corrente/);
  assert.match(COMMON_RULES, /ISO começando com DATE/);
  assert.match(COMMON_RULES, /Não copie texto de outras ACTIONS/);
});

test("parseProposalInstant rejeita dia da semana que não é o DATE", () => {
  assert.equal(parseProposalInstant(TUESDAY, "Sáb 14:00", 2), null);
  assert.equal(
    parseProposalInstant(TUESDAY, "2026-08-22T14:00:00-03:00", 2),
    null,
  );
  assert.equal(parseProposalInstant(TUESDAY, "amanhã 20:00", 2), null);
});

test("parseProposalInstant aceita HH:MM e ISO do DATE", () => {
  assert.deepEqual(parseProposalInstant(TUESDAY, "20:30", 2), {
    iso: `${TUESDAY}T20:30:00-03:00`,
  });
  assert.deepEqual(
    parseProposalInstant(TUESDAY, `${TUESDAY}T20:45:00-03:00`, 2),
    { iso: `${TUESDAY}T20:45:00-03:00` },
  );
  assert.deepEqual(parseProposalInstant(SATURDAY, "Sáb 14:00", 6), {
    iso: `${SATURDAY}T14:00:00-03:00`,
  });
});

test("sanitizeProposalCopy descarta cue legado e título de outra ACTION", () => {
  const title = "Comprar ingredientes para o café";
  const cue = sanitizeProposalCopy(
    "Sáb 14:00: lista no celular. Sair. Uma loja. Voltar antes das 18:00.",
    title,
    ["Pagar boleto da luz até sexta"],
    140,
  );
  assert.equal(cue.includes("Sáb 14:00"), false);
  assert.equal(cue.toLowerCase().includes("sair. uma loja"), false);
  assert.equal(cue.toLowerCase().includes("lista no celular"), false);
  assert.match(cue, /ingredientes/i);

  const rationale = sanitizeProposalCopy(
    "Encaixar como Pagar boleto da luz até sexta e o padrão Sáb 14:00 da compra antiga.",
    title,
    ["Pagar boleto da luz até sexta"],
    280,
  );
  assert.equal(rationale.includes("Pagar boleto da luz até sexta"), false);
  assert.equal(rationale.includes("Sáb 14:00"), false);
});

test("tarefa atômica sem due vira flex no DATE após 18:00, sem schema_invalid", () => {
  const action: GtdAction = {
    id: "task-cafe",
    title: "Comprar ingredientes para o café",
    front: "casa",
    project: "lar",
    list: "proximas_acoes",
    due: null,
    contexts: ["compra", "rua"],
    physical: true,
    url: "https://todoist.com/showTask?id=task-cafe",
  };
  assert.equal(casaActionEligibleToday(action, TUESDAY), true);
  assert.equal(casaFlexThreshold(2), "18:00:00");
  assert.equal(estimateCasaDurationMs(action.contexts, action.title), 60 * 60 * 1000);

  const range = resolveCasaFlexRange({
    date: TUESDAY,
    weekday: 2,
    gaps: weekdayGaps(),
    draftStart: "Sáb 14:00",
    draftEnd: "Sáb 16:00",
    contexts: action.contexts,
    title: action.title,
  });
  assert.ok(range);
  assert.equal(wouldBeSchemaInvalid(TUESDAY, range), false);
  assert.equal(range.start.iso.startsWith(TUESDAY), true);
  assert.ok(Date.parse(range.start.iso) >= Date.parse(`${TUESDAY}T18:00:00-03:00`));
  assert.equal(range.start.iso, `${TUESDAY}T20:00:00-03:00`);
  assert.equal(range.end.iso, `${TUESDAY}T21:00:00-03:00`);
});

test("sábado preserva horário válido da tarde no DATE", () => {
  const range = resolveCasaFlexRange({
    date: SATURDAY,
    weekday: 6,
    gaps: [
      {
        start: { iso: `${SATURDAY}T12:00:00-03:00` },
        end: { iso: `${SATURDAY}T18:00:00-03:00` },
      },
    ],
    draftStart: "14:00",
    draftEnd: "15:00",
    contexts: ["compra"],
    title: "Comprar ingredientes para o café",
  });
  assert.ok(range);
  assert.equal(range.start.iso, `${SATURDAY}T14:00:00-03:00`);
  assert.equal(wouldBeSchemaInvalid(SATURDAY, range), false);
});

test("selectCasaFallbackAction prefere compra sem due no DATE", () => {
  const shop: GtdAction = {
    id: "task-cafe",
    title: "Comprar ingredientes para o café",
    front: "casa",
    project: "lar",
    list: "proximas_acoes",
    due: null,
    contexts: [],
    physical: true,
    url: "https://todoist.com/showTask?id=task-cafe",
  };
  const later: GtdAction = {
    ...shop,
    id: "task-later",
    title: "Levar o carro na revisão",
    due: { iso: `${SATURDAY}T00:00:00-03:00` },
  };
  assert.equal(selectCasaFallbackAction([later, shop], TUESDAY)?.id, "task-cafe");
});

test("stripLegacySchedulePrefix limpa título contaminado", () => {
  assert.equal(
    stripLegacySchedulePrefix("Sáb 14:00: Comprar ingredientes para o café"),
    "Comprar ingredientes para o café",
  );
});
