# Inbox Event — Parte 1

Status: **alinhada**.

Tarefa na Inbox do Todoist com etiqueta `Event` vira compromisso no Google Calendar e uma linha no Notion. Não se vincula a nenhum projeto.

## Varredura

O script olha só a **Inbox**. Entra na análise quem tem `Event` e **não** tem `Pending`.

Com `Pending`, a tarefa é ignorada. O cliente corrige (data, hora ou conflito) e **remove** a etiqueta. Só então a próxima corrida olha de novo.

## Data e hora

Sem data **e** hora, não cria Calendar nem Notion.

O script coloca a etiqueta `Pending` e um comentário na tarefa dizendo exatamente o que falta e o que o cliente deve fazer. Exemplos:

- falta data e hora
- falta horário (data já está 20/08/2026)

Duração: a da tarefa, se existir em minutos; senão **60 minutos**.

## Conflito na agenda

Antes de gravar Notion e Calendar, o script olha se o intervalo (início + duração) cruza algum compromisso **com horário** no calendário de destino e, se estiver configurado, no calendário Instituto. Dia inteiro não conta. Encostar no fim do anterior (14:00–15:00 e 15:00–16:00) não é conflito.

Evento **desta captura** (retry) é só o que tem `Briefing:` no corpo — o Life OS que gravou. Mesmo título e mesmo horário **não** bastam: isso é compromisso de terceiro.

Se houver conflito e a tarefa **não** for P1, não cria Notion nem Calendar. Se esta captura **já** tiver compromisso (gravação anterior ou retry), o script apaga esse evento e a linha no Notion. Coloca `Pending` e um comentário deixando claro que nada foi gravado, com o slot da captura (início–fim) e o título, horário e link (se houver) de cada evento **de terceiros** que atravessa o slot. O cliente corrige a hora **ou** marca P1 e **remove** `Pending`.

Prioridade **P1** (Todoist `priority` 4) cria mesmo com conflito. A tarefa segue o fluxo normal e é apagada.

## Notion

Página [MyLife](https://app.notion.com/p/3c0f94d8161080c39f13fd36a0f9e773). Banco inline **Próximos eventos**, irmão de Projects. Sem relation com Projects.

Uma linha por evento:

| Coluna | Uso |
|---|---|
| `Nome` | título já adaptado para evento |
| `Quando` | primeira ocorrência (data + hora) |
| `Recorrência` | vazio se avulso; senão a regra em uma frase (`todo dia 15`) |
| `CalendarEventId` | URL do compromisso no Google Calendar |

O corpo da linha é o briefing: descrição, comentários e anexos da tarefa, consolidados em markdown fácil de ler.

## Calendar

Espelha data, hora e RRULE. Título adaptado. Corpo curto com o link da linha no Notion.

Lembrete da tarefa no Todoist, se existir, vira notificação do evento com as mesmas características: minutos antes e canal (`push` → popup; `e-mail` → e-mail). Lembrete absoluto vira minutos antes do início. Localização não tem equivalente no Calendar e é ignorada.

Sem lembrete na tarefa, a prioridade vira lembrete (popup):

- prioridade 4 (P1): 24 h e 60 min antes
- prioridade 3: 60 min
- prioridade 2: 30 min
- prioridade 1: 10 min

## Recorrência

Uma série no Google. No Notion, **uma linha só**, com a regra em `Recorrência`. Não explode “todo dia 15” em várias linhas.

## Ordem e fim

1. Data/hora ok; conflito resolvido ou P1
2. Notion gravado (cria ou atualiza por `Nome` + `Quando`)
3. Calendar criado ou atualizado; o link volta para `CalendarEventId` **na mesma linha** (não cria outra)
4. Tarefa **apagada** da Inbox

Se o Calendar falhar, a linha no Notion permanece e a tarefa **não** é apagada (e continua sem `Pending`) para a próxima varredura.

## Etiquetas

| Nome | Quem cria |
|---|---|
| `Event` | o cliente, na captura |
| `Pending` | o script, se faltar data/hora **ou** houver conflito sem P1; o cliente remove depois de corrigir |
