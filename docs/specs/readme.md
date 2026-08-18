# Specs do Life OS

Contrato de comportamento do MAS. Código em `src/` implementa este contrato. Nada aqui autoriza inventar sexta frente, evento de cápsula, segundo bloco da Loja ou write em série protegida.

**Como ler:** a spec 00 é a fonte da verdade das regras. 01, 02 e 03 especializam portas, Mestre e especialistas. [Funcionalidade.md](./Funcionalidade.md) descreve uma corrida como o código faz hoje. Este índice separa o que já está no `src/` do que ainda é só contrato.

---

## Índice

| Arquivo | Conteúdo |
|---|---|
| [Funcionalidade.md](./Funcionalidade.md) | Ciclo diário (entrada → coleta → grafo → persistência) |
| [00-architecture-overview.md](./00-architecture-overview.md) | Visão, camadas GTD/PARA/Kanban, grade, kernel, políticas |
| [01-api-integrations.md](./01-api-integrations.md) | Portas Todoist / Notion / Calendar, erros, env |
| [02-master-agent-orchestrator.md](./02-master-agent-orchestrator.md) | CRON, grafo, merge, teto anti-ruído |
| [03-specialist-agents.md](./03-specialist-agents.md) | Cinco especialistas, prompts, autorização |

Runtime do contrato: Node.js ≥ 20 · TypeScript `strict` · ESM · fuso `America/Sao_Paulo`.

---

## Status de implementação

Leitura honesta do `src/` em relação às specs 00–03. Itens sem arquivo correspondente **não estão prontos**, mesmo que o contrato já os descreva.

### Feito

- Ambiente Node 20+, `"type": "module"`, `tsconfig.json` strict com decorators.
- Kernel em Zod (`src/core/domain/schemas.ts`) alinhado aos tipos da spec 00, com `GtdAction.front` anulável (Inbox sem projeto) e `OrchestratorResult` com `rejected` + `partial`.
- Catálogo das 5 frentes, hubs Notion, 13 séries protegidas e `assertNotProtectedWrite` (`catalog.ts`).
- Portas `TodoistPort`, `NotionPort`, `CalendarPort` (aliases `ITodoistPort`, `INotionPort`, `IGoogleCalendarPort`).
- Adaptadores em `src/adapters/apis/` usando os SDKs oficiais — **não** são mais stubs que devolvem mock de tarefa/evento.
- Container Inversify em `src/infrastructure/di/inversify.config.ts`.
- `MasterAgent` carrega as três portas, monta o estado, invoca `LifeOsGraph` e persiste o resultado.
- Grafo LangGraph com três nós: `triage` → `specialist` → `builder` (`LifeOsGraph.ts`).
- Prompts de sistema em `specialist-prompts.ts` (triagem, cinco especialistas, callout do Daily Plan).
- Políticas determinísticas no `builder`: PagBank, sono, almoço, teto de 3 flex, 1 flex por frente, Loja/Instituto sem flex extra, gap 08:20–09:00 recusado.
- Entrada `src/test-run.ts` (`dryRun: false`) e wrapper `src/run-life.sh` → `logs/cron.log`.

### Parcial

| Contrato | O que o código faz |
|---|---|
| Notion Specs da Agenda (`Status = ativo`) | Query em `NOTION_PROJECTS_DB_ID` com filtro nativo `Status = Em andamento`; mapeamento ainda espera propriedades de spec (`Nome`, `Pilar`, `Prefixo`, `Cue`, …) |
| `upsertDailyPlan` / `applyKanbanMoves` / `listKanban` | Mapas em memória no `NotionAdapter`. Não criam página no workspace |
| `listBusy` no ciclo diário | Porta e adaptador existem; o Mestre **não chama** `listBusy`. Ocupado = só `listProtectedOccurrences` |
| Exceção plantão / rito → `deleteOccurrence` | Heurística preenche `constraints`; o Mestre **não apaga** ocorrência |
| `ILlmPort` + `IClock` | Tokens existem; o grafo instancia `ChatOpenAI` e formata data com `Intl` |
| OAuth Google da spec (`GOOGLE_OAUTH_*` ou service account) | Código lê `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| Job CRON `20 5 * * *` via `node-cron` + lock file | Dependência `node-cron` instalada e **não usada**. Não há `src/jobs`. Lock `/tmp/life-os-daily-{date}.lock` ausente |

### Ainda não existe no `src/`

- `src/agents/`, `src/jobs/`, `src/index.ts`.
- Adaptadores `OpenAiLlmAdapter` e `SystemClock`.
- Classes Inversify por especialista (`AGENT_TOKENS`). Os cinco correm como funções no nó `specialist`.
- Tools LangChain `list_actions` / `list_specs` / `list_kanban` no LLM do especialista (o Mestre já injeta o recorte no prompt).
- Jobs `evening` e `weekly` (spec 02: fora de v0.1).
- Variáveis `LIFE_OS_TZ`, `LIFE_OS_CRON`, `LIFE_OS_PLANTAO` — nenhum `process.env` as lê.

---

## Decisões que o código já aplica

- Arquitetura hexagonal: domínio não importa SDK. Adaptadores traduzem para tipos do kernel.
- Validação Zod nos DTOs.
- Timebox PagBank 09:00–18:00 em dia útil: fallback hardcoded mesmo se a API de Calendar falhar (`busy_fallback` no resultado).
- Idempotência de flex: `extendedProperties.private.lifeOsKey` no upsert.
- Triagem da Inbox: LLM delega para um dos cinco agentes **ou** `ignore_pagbank`. Item sem delegação cai no fallback por `front` / palavras PagBank.
- Persistência (ordem no Mestre): Calendar flex → Notion Daily Plan (memória) → Kanban (memória) → Todoist `promoteToToday` só se todos os upserts de Calendar da corrida tiverem ok.

---

## Backlog imediato (só o que as specs já pedem e o `src/` ainda não tem)

1. Porta `ILlmPort` / `IClock` e tirar `ChatOpenAI` de dentro do domínio.
2. Persistência real de Daily Plan e Kanban no Notion.
3. Mestre chamar `listBusy` (não só séries protegidas) e `deleteOccurrence` quando `plantao` / `ritoNoSabado`.
4. Job em `src/jobs` com fuso, expressão 05:20 e lock de uma corrida por `date`.
5. Alinhar o banco Notion da query (`Em andamento` vs. Specs `ativo` / `rascunho`) ao contrato da spec 01.
