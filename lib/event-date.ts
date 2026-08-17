/**
 * Event detail pages are addressed by calendar day — `/events/20260816` — so a
 * member can share "그날 일정" without knowing an event id. Every helper works
 * on the local calendar day, which is the day the member actually plays.
 */

export function toEventDateKey(startsAt: string) {
  const date = new Date(startsAt);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function eventDatePath(startsAt: string) {
  return `/events/${toEventDateKey(startsAt)}`;
}

/** Rejects both malformed keys and impossible days such as 20260231. */
export function parseEventDateKey(key: string) {
  if (!/^\d{8}$/.test(key)) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(4, 6));
  const day = Number(key.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** Formats without a Date so the label never shifts with the rendering time zone. */
export function formatEventDateKey(key: string) {
  const date = parseEventDateKey(key);
  return date ? `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일` : key;
}
