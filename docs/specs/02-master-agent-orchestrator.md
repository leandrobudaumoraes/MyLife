# 02 — Agente Mestre (orquestrador e timeblocking)

**Status:** contrato v0.1 (SDD)  
**Depende de:** [00-architecture-overview.md](./00-architecture-overview.md), [01-api-integrations.md](./01-api-integrations.md)  
**Alimenta:** [03-specialist-agents.md](./03-specialist-agents.md)

O Agente Mestre é o único processo que **escreve no relógio**. Roda em CRON no Debian, consulta os cinco especialistas em paralelo, aplica políticas de conflito e anti-ruído, e materializa o timeblocking do dia.

Ele **não** é dono de frente. Não prioriza Mim sobre Família “por default”: a grade protegida já decidiu os donos. O Mestre só preenche **gaps** e aplica exceções.

---

## 1. Responsabilidade (SRP)

| Faz | Não faz |
|---|---|
| Disparar fan-out dos 5 especialistas | Inventar ação GTD |
| Calcular busy + gaps | Dose, laudo, substância (vault clínico) |
| Merge e teto de 3 blocos flex | Segundo item da Loja; segundo bloco Instituto |
| Upsert de ocorrência flex | PATCH de série protegida |
| Daily Plan no Notion | Criar spec de bloco |
| Promover Todoist Hoje (existente) | Completar tarefa |
| Marcar frentes descobertas | Sexto agente PagBank |
| Apagar ocorrência se plantão/rito explícito | Bloquear 24 h de plantão no Calendar |

---

## 2. CRON e janelas

Fuso: `America/Sao_Paulo`. O processo Node fica up (systemd user ou cron do sistema chamando `node dist/jobs/daily-orchestrator.js`).

| Job | Expressão | Papel |
|---|---|---|
| `daily` | `20 5 * * *` | Timeblocking de **hoje** antes das 06:00 humanas |
| `evening` | `30 21 * * *` | Opcional v0.2: pré-plano de amanhã. **Fora de v0.1** |
| `weekly` | `0 21 * * 0` | Opcional v0.2: revisão semanal. **Fora de v0.1** |

`LIFE_OS_CRON` sobrescreve só o job `daily`.

Regras:

- 05:20 é máquina, não humano. Nenhum evento começa 05:xx.
- Se a corrida `daily` atrasar e `now() ≥ 06:00`, ainda roda, mas **não** move blocos já em andamento (`start ≤ now`).
- Uma corrida por `date`. Lock file `/tmp/life-os-daily-{date}.lock` (ou flock). Segunda invocação no-op com log.

```typescript
export interface CronJobSpec {
  readonly name: "daily";
  readonly expression: string;
  readonly timezone: "America/Sao_Paulo";
  readonly timeoutMs: 180_000;
}

export const DAILY_JOB: CronJobSpec = {
  name: "daily",
  expression: "20 5 * * *",
  timezone: "America/Sao_Paulo",
  timeoutMs: 180_000,
};
```

---

## 3. Grafo LangGraph

```mermaid
stateDiagram-v2
  [*] --> LoadClock
  LoadClock --> LoadBusy
  LoadBusy --> ComputeGaps
  ComputeGaps --> FanOutSpecialists
  FanOutSpecialists --> MergeProposals
  MergeProposals --> ApplyPolicies
  ApplyPolicies --> PersistCalendar
  PersistCalendar --> PersistNotion
  PersistNotion --> PersistTodoist
  PersistTodoist --> EmitResult
  EmitResult --> [*]
```

Nós são funções puras sobre `OrchestratorState`, com I/O só via portas injetadas.

```typescript
export interface OrchestratorState {
  readonly date: string;
  readonly now: CivilInstant;
  readonly plantao: boolean;
  readonly ritoNoSabado: boolean;
  readonly occupied: readonly CalendarEventRef[];
  readonly rites: readonly CalendarEventRef[];
  readonly gaps: readonly TimeRange[];
  readonly specialistOutputs: readonly SpecialistOutput[];
  readonly merged: readonly TimeBlockProposal[];
  readonly accepted: readonly TimeBlockProposal[];
  readonly rejected: readonly RejectedProposal[];
  readonly kanbanMoves: readonly KanbanMove[];
  readonly plan: DailyPlan | null;
  readonly writtenEventIds: readonly string[];
  readonly errors: readonly IntegrationError[];
}

export interface RejectedProposal {
  readonly proposal: TimeBlockProposal;
  readonly reason:
    | "protected_overlap"
    | "pagbank_overlap"
    | "sleep_overlap"
    | "lunch_overlap"
    | "noise_cap"
    | "duplicate_front_flex"
    | "loja_second_item"
    | "instituto_second_delivery"
    | "no_physical_action"
    | "past_slot"
    | "schema_invalid";
}
```

Contrato do grafo:

```typescript
export interface IMasterOrchestrator {
  run(date: string): Promise<Result<OrchestratorResult>>;
}
```

Fan-out: `Promise.all` nos cinco especialistas. Timeout por especialista: 25 s. Falha de um → `uncovered: true` daquela frente, as outras seguem.

---

## 4. Entrada: busy, gaps, restrições

### 4.1 Detectar plantão e rito

```typescript
export interface ConstraintDetector {
  detect(input: {
    date: string;
    occupied: readonly CalendarEventRef[];
    rites: readonly CalendarEventRef[];
  }): SpecialistConstraints;
}
```

Heurística v0.1 (determinística, sem LLM):

- `plantao`: existe evento no `primary` cujo summary contém `plantão` / `plantao` (case insensitive) cobrindo madrugada do `date`, **ou** flag futura `LIFE_OS_PLANTAO=1`. Plantão **não** é série.
- `ritoNoSabado`: `date` é sábado **e** `rites.length > 0` no dia.
- `smileOrConsult`: evento `SAUDE` avulso (não está em `PROTECTED_SERIES_IDS`) sobreposto a 17:30–20:00.

Efeito:

| Flag | Ação do Mestre |
|---|---|
| `plantao` | Pede `deleteOccurrence` de Zone 2 do dia e Ultra da **noite seguinte** se for ter/qui. Escola **intocada**. Sono: apagar ocorrência da madrugada acordada, não a série. 90/5 e chá verde não entram em lugar nenhum |
| `ritoNoSabado` | Pede `deleteOccurrence` da oficina `jrpcc165gkfi6nqnbb6gsob4uo` naquele sábado. Não cria substituto |
| `smileOrConsult` | Não cria flex em cima. Não reabre ocorrência de Família já apagada |

### 4.2 Cálculo de gaps

```typescript
export interface GapCalculator {
  compute(input: {
    date: string;
    occupied: readonly CalendarEventRef[];
    weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  }): readonly TimeRange[];
}
```

Algoritmo:

1. Janela civil do dia: `06:00` → `22:00` (fora = sono, intocável para flex).
2. Subtrair todos os `occupied` opacos.
3. Subtrair PagBank 09:00–12:00 e 13:00–18:00 em dias úteis **mesmo se a série falhar na API** (fallback hardcoded).
4. Subtrair almoço 12:00–13:00 em dias úteis (fallback).
5. Descartar gap `< 25 minutos` (TDAH: não criar microbloco).
6. Sábado: 06:00–09:00 e 12:00–22:00 são candidatos (09:00–12:00 oficina protegida, salvo rito).
7. Domingo: 09:20–22:00 após Ultra.

Gaps típicos em dia útil: `08:20–09:00` (40 min). Esse gap **não** é para engenharia profunda nem para Loja. Pode receber flex de Casa só se for ação `Casa`/`Celular` de ≤ 25 min (ex.: boleto). Default v0.1: **não preencher 08:20–09:00** — café/bloco 03 é Todoist, não evento.

Política v0.1 de preenchimento:

- Dia útil: flex preferencialmente **não** compete com 18:00–20:00 (Família). Exceção: quinta 18:00 já é Loja (protegido).
- Sábado tarde: único gap largo para Casa (`compra` + sair).
- Quarta 20:00: buscar Arthur (Família). Sem Ultra. Sem flex de Instituto.

---

## 5. Consumo dos especialistas

O Mestre monta o mesmo `SpecialistContext` base e **filtra** por frente:

```typescript
export interface SpecialistAgent {
  readonly id: Exclude<AgentId, "mestre">;
  readonly front: FrontId;
  propose(ctx: SpecialistContext): Promise<SpecialistOutput>;
}
```

Filtro obrigatório no Mestre **depois** do retorno (defesa em profundidade):

```typescript
export function assertOwnFront(out: SpecialistOutput): void {
  if (out.proposals.some((p) => p.front !== out.front)) {
    throw new Error(`Especialista ${out.agentId} propôs frente alheia`);
  }
}
```

Proposta com `conflictsWithProtected: true` é morta no merge (o especialista deve marcar; o Mestre recalcula overlap de qualquer forma).

Schema Zod da saída (validação pós-LLM):

```typescript
import { z } from "zod";

export const TimeBlockProposalSchema = z.object({
  agentId: z.enum([
    "pessoal",
    "infraestrutura_casa",
    "profissional_instituto",
    "operacoes_loja_lua_branca",
    "logistica_familiar",
  ]),
  front: z.enum(["mim", "casa", "instituto", "loja_lua_branca", "familia"]),
  prefix: z.enum(["SAUDE", "LAR", "INSTITUTO", "LOJA", "FAMILIA"]),
  title: z.string().min(3).max(64),
  range: z.object({
    start: z.object({ iso: z.string() }),
    end: z.object({ iso: z.string() }),
  }),
  kind: z.enum([
    "protected_series",
    "exception_occurrence",
    "flex_timeblock",
    "travel_buffer",
  ]),
  gtdActionId: z.string().nullable(),
  cue: z.string().min(1).max(140),
  energy: z.enum(["alta", "media", "baixa"]),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  conflictsWithProtected: z.boolean(),
  rationale: z.string().max(280),
});
```

`kind: "protected_series"` na boca do especialista = **ignorado** (especialista não “repropõe” Sono/Ultra). Só `flex_timeblock` entra no teto.

---

## 6. Merge e resolução de conflito

Ordem determinística (sem LLM neste nó):

```
1. Descartar schema_invalid, past_slot, no_physical_action (flex sem gtdActionId)
2. Descartar overlap com occupied opaco (protected_overlap)
3. Descartar overlap PagBank / sono / almoço
4. Loja: no máximo 1 flex no dia e somente se weekday === 4 (quinta)
   e range ⊆ 18:00–19:00 — na prática a série já cobre; flex extra = loja_second_item
5. Instituto: no máximo 1 flex, somente sábado, range ⊆ 09:00–12:00
   — série já cobre; flex extra = instituto_second_delivery
6. Família: flex não invade 06:00–07:45 nem escola
7. Mim: flex não move Ultra / Zone 2 / sono
8. Ranking dos flex restantes:
     priority ASC (0 = mais urgente), depois duração menor, depois FrontOrder
9. Teto: 3 flex no dia (noise_cap)
10. No máximo 1 flex por frente por dia (duplicate_front_flex)
```

`FrontOrder` (desempate, não prioridade moral):

```typescript
export const FRONT_TIEBREAK: readonly FrontId[] = [
  "familia",
  "mim",
  "casa",
  "instituto",
  "loja_lua_branca",
];
```

Família ganha desempate porque TDAH no convívio é restrição: não se “encaixa um boleto” em cima do Arthur.

Sobreposição entre dois flex aceitos: o de pior rank é rejeitado (`protected_overlap` não — usar `duplicate_front_flex` ou recorte). v0.1 **não recorta** horários; rejeita o inteiro.

```typescript
export interface PolicyEngine {
  apply(input: {
    occupied: readonly CalendarEventRef[];
    gaps: readonly TimeRange[];
    outputs: readonly SpecialistOutput[];
    weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    now: CivilInstant;
  }): {
    accepted: readonly TimeBlockProposal[];
    rejected: readonly RejectedProposal[];
    kanbanMoves: readonly KanbanMove[];
    uncoveredFronts: readonly FrontId[];
  };
}
```

Frente descoberta: especialista `uncovered: true` **ou** zero presença no dia (nem protegido nem flex). PagBank não conta como frente.

Presença por frente no dia útil típico (não descoberta):

| Frente | Cobertura mínima |
|---|---|
| Mim | Sono + almoço + Zone 2 (seg–sex) e/ou Ultra (ter/qui/dom) |
| Família | Casa 06:00 + escola (seg–sex) + 18:00 (seg/ter/qua/sex) |
| Casa | Compartilha 18:00; sábado tarde é o slot próprio. Dia útil sem flex Casa **não** marca descoberta |
| Instituto | Só sábado. Dia útil = N/A (não listar como descoberta) |
| Loja Lua Branca | Só quinta 18:00. Outros dias = N/A |

---

## 7. Timeblocking — o que é escrito

```mermaid
flowchart LR
  Acc[accepted flex] --> Key["lifeOsKey"]
  Key --> Upsert["upsertFlexEvent"]
  Prot[séries protegidas] --> Skip[não escrever]
  Ex[plantão / rito] --> Del["deleteOccurrence"]
```

Cue do flex (Mestre monta, não o LLM):

1. Se `proposal.spec` existe, cue = spec.cue (já 1 linha).
2. Senão cue = `proposal.cue` truncado a 140 chars, uma linha, sem markdown.
3. Título = `{prefix} - {title sem prefixo}`.

`lifeOsKey = lifeos:{date}:{front}:{gtdActionId}`.

Kanban: todo flex aceito gera `KanbanMove` `next → timeblocked` se houver card; senão o Daily Plan lista a ação sem card novo.

Todoist: `promoteToToday` apenas para `todoistTodayIds` **interseção** com `accepted.gtdActionId`. Especialista não promove sozinho.

---

## 8. Prompt de sistema do Mestre

O nó `ApplyPolicies` é determinístico. O LLM do Mestre **só** existe no nó opcional `NarratePlan` (v0.1 **ligado**, temperatura 0) para a frase do callout do Daily Plan. Não escolhe horário.

```
Você é o Agente Mestre do Life OS do Leandro.

Escreva UMA frase (≤ 140 caracteres) para o callout do plano do dia.
A frase é o primeiro movimento humano após as 06:00, não um resumo de carreira.

Regras:
- Português do Brasil, segunda pessoa, concreto.
- Não mencionar PagBank, promoção, inglês, IMAO, dose, cápsula.
- Não inventar compromisso que não esteja em ACCEPTED_BLOCKS.
- Se plantão: lembrar escola 07:15 e que Zone 2 cai.
- TDAH: zero empolgação, zero lista.

ACCEPTED_BLOCKS: {json}
CONSTRAINTS: {json}
```

Saída: `{ "callout": string }` validado por Zod. Falha → callout fallback: `Todoist «Ao acordar». Sair ~07:00 com o Arthur.`

---

## 9. Persistência — ordem e rollback

1. Calendar flex upserts (N ≤ 3).
2. Calendar deleteOccurrence (0–N, só flags).
3. Notion `upsertDailyPlan` + `applyKanbanMoves`.
4. Todoist `promoteToToday`.

Não há transação distribuída. Compensação v0.1:

- Se Calendar ok e Notion falha: resultado `ok: false` parcial; **não** apaga os flex (o plano no relógio vale mais). Retry no próximo CRON é idempotente.
- Se Calendar falha no item 2 de 3: não promove Todoist; Notion registra `skipped`.
- Nunca compensar com delete de série.

```typescript
export interface OrchestratorResult {
  readonly plan: DailyPlan;
  readonly writtenEventIds: readonly string[];
  readonly skipped: readonly string[];
  readonly rejected: readonly RejectedProposal[];
  readonly partial: boolean;
}
```

(Estende o tipo do doc 00 com `rejected` e `partial`.)

---

## 10. Prompt interno / ferramentas do grafo

Ferramentas (LangGraph nodes, não function-calling livre para o LLM de políticas):

| Node | Portas | Side effect |
|---|---|---|
| `LoadBusy` | `IGoogleCalendarPort.listBusy`, `listProtectedOccurrences`, `listInstitutoRites` | não |
| `FanOut` | 5× `SpecialistAgent.propose` | não |
| `ApplyPolicies` | `PolicyEngine` | não |
| `PersistCalendar` | `upsertFlexEvent`, `deleteOccurrence` | sim |
| `NarratePlan` | `ILlmPort` | não |
| `PersistNotion` | `upsertDailyPlan`, `applyKanbanMoves` | sim |
| `PersistTodoist` | `promoteToToday` | sim |

O LLM dos especialistas **pode** usar tools de leitura (listar ações) — ver spec 03. O LLM do Mestre **não** tem tools de write.

---

## 11. Regras invioláveis (checklist do implementador)

1. `assertNotProtectedWrite` em todo write.
2. PagBank hardcoded se a API não devolver as séries.
3. Teto 3 flex.
4. Loja: zero flex fora da quinta; zero segundo item.
5. Instituto: zero flex fora do sábado; zero segunda entrega.
6. Não acordar 05:xx no Calendar.
7. Almoço intocável.
8. Cue de manhã autossuficiente — o Mestre não coloca “abrir Notion” em Casa/Escola/Zone 2.
9. Idioma: identificadores em inglês; textos de usuário em pt-BR.

---

## 12. Exemplo de corrida (terça sem plantão)

Ocupado protegido: Casa, Escola, Zone 2, PagBank ×2, Almoço, Família 18:00–20:00, Ultra 20:00–21:15, Sono.

Gaps reais: 08:20–09:00 (não preencher), e nenhum gap noturno.

Especialistas:

- Pessoal: zero flex (rotina já no Todoist + Ultra protegida).
- Casa: propõe “Pagar luz” 08:25–08:50 → **rejeitado** (política: não preencher 08:20–09:00) **ou** aceito se `priority === 0` e contexto `Celular`. v0.1 default = rejeitar (`noise_cap` / gap policy). Implementação deve documentar a escolha no `rejected.reason`.
- Instituto: `uncovered` N/A (não sábado).
- Loja: N/A (não quinta).
- Família: zero flex.

Daily Plan: callout de Casa/Arthur. Frentes N/A não listadas. Casa não é descoberta.

Sábado sem rito: Instituto cobre com série + 1 entrega Todoist promovida. Casa pode ganhar **um** flex 14:00–16:00 se houver `compra` no projeto Lar.

---

## 13. Critério de aceite desta spec

1. Job 05:20 no fuso correto; lock impede duplicata.
2. Falha do especialista Loja não impede Família.
3. Proposta que cruza 13:00–18:00 em dia útil nunca é escrita.
4. Dois CRON no mesmo dia não duplicam evento (`lifeOsKey`).
5. Sábado com rito: oficina tem ocorrência removida; sem flex Instituto substituto.
6. Callout do Notion ≤ 140 chars e não cita dose.
7. Grafo sem aresta de especialista → Calendar port.
