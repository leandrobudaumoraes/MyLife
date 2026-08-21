export function plainTextFromHtml(value: string): string {
  return value
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>/giu, " $1 ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

export function googleEventIdFromUrl(url: string | null): string | null {
  if (!url || url.trim().length === 0) {
    return null;
  }
  if (!/^https?:\/\//i.test(url)) {
    return url;
  }
  try {
    const parsed = new URL(url);
    const eid = parsed.searchParams.get("eid");
    if (eid) {
      const padded = eid.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(padded, "base64").toString("utf8");
      const eventId = decoded.split(/\s+/u)[0];
      return eventId && eventId.length > 0 ? eventId : null;
    }
    const edit = parsed.pathname.match(/\/eventedit\/([^/]+)/);
    return edit?.[1] ? decodeURIComponent(edit[1]) : null;
  } catch {
    return null;
  }
}

export function notionPageIdFromBriefing(
  description: string | null,
): string | null {
  if (!description) {
    return null;
  }
  const match = plainTextFromHtml(description).match(
    /Briefing:\s*(https?:\/\/[^\s]+)/i,
  );
  if (!match?.[1]) {
    return null;
  }
  try {
    const url = new URL(match[1]);
    const hex = url.pathname.replaceAll("/", "").replaceAll("-", "");
    const id = hex.match(/[0-9a-f]{32}/i)?.[0]?.toLowerCase();
    if (!id) {
      return null;
    }
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  } catch {
    return null;
  }
}

export function calendarEventLink(
  htmlLink: string | null,
  eventId: string,
): string {
  if (htmlLink && htmlLink.length > 0) {
    return htmlLink;
  }
  return `https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(eventId)}`;
}
