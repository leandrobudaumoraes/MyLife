# Ciclo diário — o que o código faz numa corrida

Este arquivo descreve a corrida **como está em `src/`**, não o alvo da spec 02 (nove nós LangGraph, `src/jobs`, lock file). Regras de negócio (grade, tetos, frentes) continuam nas specs 00–03.

Entrada: `src/test-run.ts` → `MasterAgent.executeDailyTriage({ dryRun: false })`. O wrapper `src/run-life.sh` recarrega o shell, entra na raiz do repo e redireciona a saída para `logs/cron.log`.

---

## 1. Disparo

Não há `node-cron` nem `src/jobs` neste repositório. Quem agenda a máquina (crontab do Debian, systemd) chama o wrapper. O contrato da spec 02 é `20 5 * * *` no fuso `America/Sao_Paulo` — antes das 06:00 humanas. O código não lê `LIFE_OS_CRON`.

`dryRun: false` nesta entrada: a corrida **tenta escrever** nas portas. `executeDailyTriage({ dryRun: true })` existe no Mestre e só loga o payload.

---

## 2. Coleta (antes do grafo)

O Mestre fala com as três portas e só então instancia o LangGraph.

| Porta | Chamada | Uso |
|---|---|---|
| Todoist | `listActions({ date, front: "all" })` | Inbox nativa + tarefas fora de Encubar/Arquivar, só ação física |
| Todoist | `resolveProject` × Vitalidade, Lar, Família, Instituto | Lista de projetos ativos para o nó de triagem |
| Notion | `listActiveSpecs("all")` | Query do banco `NOTION_PROJECTS_DB_ID` com `Status = Em andamento` |
| Notion | `listKanban(date, "all")` | Mapa em memória (vazio na primeira corrida do processo) |
| Calendar | `listProtectedOccurrences(date)` | Ocorrências do dia cuja série está no catálogo das 13 |
| Calendar | `listInstitutoRites(date)` | Eventos do calendário Instituto (rito); sem write |

`listBusy` **não** entra nesta corrida. Ocupado do grafo = séries protegidas. Se `listProtectedOccurrences` falhar, o Mestre segue com lista vazia, marca `partial` e anota `busy_fallback` com PagBank 09:00–18:00 hardcoded.

Falha em Todoist `listActions` ou Notion `listActiveSpecs` aborta a corrida (não há grafo).

Sem `OPENAI_API_KEY`, `createLifeOsGraph` devolve erro `llm` / `unauthorized`.

---

## 3. Grafo LangGraph (`triage` → `specialist` → `builder`)

Modelo: `OPENAI_MODEL` ou default `gpt-4o-mini`, `temperature: 0`, timeout 25 s por especialista.

### 3.1 `triage`

Calcula `constraints` (plantão no summary, rito no sábado, Smile/consulta SAUDE avulsa 17:30–20:00) e `gaps` (06:00–22:00 menos ocupado, menos PagBank + almoço em dia útil, menos oficina 09:00–12:00 no sábado; descarta gap menor que 25 min).

O LLM recebe Inbox + projetos + títulos de specs e devolve `delegations`: um especialista por item, ou `ignore_pagbank`. Item sem linha do LLM cai no fallback: PagBank / `front === null` → ignorar; senão o agente da frente do catálogo.

### 3.2 `specialist`

Os cinco agentes rodam em `Promise.all`, na ordem documental `SPECIALIST_ORDER` (Família, Pessoal, Casa, Instituto, Loja). Cada um vê só as ações delegadas a ele (ou da sua frente e não delegadas a outro), o Kanban da frente, specs completas, ocupado e gaps. O user prompt manda isolar `start`/`end` no DATE e não copiar texto entre ACTIONS.

Saída: `SpecialistDraft` (propostas curtas) convertido para `TimeBlockProposal` com prefixo do catálogo. `gtdActionId` inventado é descartado. `start`/`end` que não parseiam para o DATE caem fora (não viram `00:00`). Em Casa, ação sem `due` (ou `due` no DATE) é encaixada no gap pós-expediente e o cue/rationale são sanitizados contra prefixo de dia e texto de outras tarefas. Falha ou timeout → `uncovered: true` daquela frente; as outras seguem.

Nenhum especialista escreve Calendar.

### 3.3 `builder`

Filtro determinístico (sem LLM para horário):

1. Descarta flex sem `gtdActionId`, schema inválido, slot no passado, sono, almoço, PagBank 09:00–18:00, overlap com protegido, 08:20–09:00 em dia útil (`noise_cap`).
2. Qualquer flex de Loja → `loja_second_item`. Qualquer flex de Instituto → `instituto_second_delivery`.
3. Ranking: `priority` ASC, duração menor, `FRONT_TIEBREAK` (Família, Mim, Casa, Instituto, Loja).
4. Teto: 3 flex no dia; no máximo 1 por frente; sem recorte de horário (rejeita o inteiro).

Itens `ignore_pagbank` viram nota no plano, não viram evento nem `promoteToToday`.

Callout do Daily Plan: um segundo chamado LLM (`MASTER_CALLOUT_PROMPT`), ≤ 140 caracteres. Falha → `Todoist «Ao acordar». Sair ~07:00 com o Arthur.`

O builder monta `calendarWrites` com `lifeOsKey = lifeos:{date}:{front}:{gtdActionId}`.

---

## 4. Persistência (depois do grafo)

Ordem no Mestre, se `dryRun` for falso:

1. **Calendar** — `upsertFlexEvent` para cada write (insert ou patch pelo `lifeOsKey`). Nunca PATCH de série protegida (`assertNotProtectedWrite`).
2. **Notion** — `upsertDailyPlan` e, se houver moves, `applyKanbanMoves`. Hoje: persistência **em memória** no processo. Não cria página no workspace.
3. **Todoist** — `promoteToToday` só se **todos** os upserts de Calendar da corrida tiverem ok, e só para IDs em `todoistTodayIds` ∪ `gtdActionId` dos blocos aceitos, **exceto** os `ignore_pagbank`. O CRON não chama `complete()`.

`deleteOccurrence` existe no adaptador e **não é chamado** pelo Mestre nesta versão.

Se Calendar parcial: Todoist não promove; Notion ainda tenta gravar o plano (no mapa em memória); o resultado vem com `partial: true` e `skipped`.

---

## 5. O que a corrida não faz

- Não cria tarefa, projeto, spec ou série.
- Não agenda dentro de PagBank, almoço, sono, 05:xx.
- Não cria segundo item da Loja nem segunda entrega do Instituto.
- Não recria as 13 séries canônicas.
- Não abre Notion às 06:00 (o Watch lê o Calendar; o Daily Plan no Notion ainda nem persiste).
- Não interpreta dose, IMAO ou vault clínico.

O relógio humano às 06:00 deve ver, no máximo, as séries protegidas + até 3 flex com cue de 1 linha. A lista Hoje no Todoist só ganha itens que já existiam.
