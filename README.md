# Life OS

Esqueleto Node.js / TypeScript para orquestrar **Todoist**, **Notion**, **Google Calendar** e um **LLM** (LangChain + LangGraph).

Spec alinhada: [Inbox Event](docs/specs/inbox-event.md) — Inbox `Event` → Notion **Próximos eventos** → Google Calendar.

---

## Como rodar

Requisitos: Node.js ≥ 20, arquivo `.env` na raiz (veja [`.env.example`](.env.example)).

```bash
npm install
npx tsx src/test-run.ts
```

Se o lock do dia já fechou: `LIFE_OS_FORCE=1 npx tsx src/test-run.ts`.

Ou o wrapper de cron:

```bash
bash src/run-life.sh
```

A corrida processa a Inbox do Todoist (`Event` sem `Pending`): briefing no Notion, compromisso no Calendar, tarefa apagada. Lock em `/tmp/life-os-daily-{date}.lock` impede segunda corrida no mesmo dia (`LIFE_OS_FORCE=1` reabre).

| Script | Situação |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | emite `dist/` |
| `npm test` | testes de domínio e infraestrutura |
| `npm run dev` / `npm start` | `src/index.ts` / `dist/index.js` |

---

## Layout

```
src/
  index.ts                         # npm start / dev
  test-run.ts                      # cron
  bootstrap.ts                     # corrida + lock
  run-life.sh                      # wrapper bash → test-run + logs/cron.log
  core/
    domain/
      schemas.ts
      result.ts
      clock.ts
      inbox-event/                 # Parte 1: Inbox Event
      orchestrator/
        LifeOs.ts
        LifeOsGraph.ts
    ports/
    adapters/apis/
    infrastructure/
```

`node-cron` está nas dependências; pasta `src/jobs` ainda não existe.
