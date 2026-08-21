import assert from "node:assert/strict";
import { test } from "node:test";

import { calendarEventLink, googleEventIdFromUrl, notionPageIdFromBriefing } from "./links.js";

test("extrai o id do evento a partir do htmlLink do Google", () => {
  const eventId = "abc123xyz";
  const eid = Buffer.from(`${eventId} user@gmail.com`)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
  const url = `https://www.google.com/calendar/event?eid=${eid}`;
  assert.equal(googleEventIdFromUrl(url), eventId);
});

test("htmlLink vazio cai no editor do Calendar", () => {
  assert.equal(
    calendarEventLink(null, "evt-1"),
    "https://calendar.google.com/calendar/u/0/r/eventedit/evt-1",
  );
});

test("extrai o page id do Notion a partir do Briefing", () => {
  assert.equal(
    notionPageIdFromBriefing(
      "Briefing: https://www.notion.so/3c2f94d816108143af5ffcf5599fba5d",
    ),
    "3c2f94d8-1610-8143-af5f-fcf5599fba5d",
  );
  assert.equal(
    notionPageIdFromBriefing(
      '<html>Briefing: <a href="https://www.notion.so/3c2f94d816108143af5ffcf5599fba5d">link</a></html>',
    ),
    "3c2f94d8-1610-8143-af5f-fcf5599fba5d",
  );
  assert.equal(notionPageIdFromBriefing("sem briefing"), null);
});
