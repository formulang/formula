export type ParsedIsoDate = { year: number; month: number; day: number };
export type ParsedIsoTime = { hour: number; minute: number; second: number };

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatIsoDate(d: ParsedIsoDate): string {
  const y = String(d.year).padStart(4, '0');
  return `${y}-${pad2(d.month)}-${pad2(d.day)}`;
}

export function formatIsoTime(t: ParsedIsoTime): string {
  return `${pad2(t.hour)}:${pad2(t.minute)}:${pad2(t.second)}`;
}

export function parseIsoDate(value: unknown): ParsedIsoDate | null {
  if (typeof value !== 'string') return null;
  // Accept either YYYY-MM-DD or full ISO datetime strings like YYYY-MM-DDTHH:MM:SSZ.
  const m =
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)?$/.exec(
      value,
    );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Validate using UTC date round-trip (rejects 2026-02-30 etc).
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function parseIsoTime(value: unknown): ParsedIsoTime | null {
  if (typeof value !== 'string') return null;

  // Accept either full ISO datetime strings or only time-of-day.
  const dt = /[T ]([0-9]{2}:[0-9]{2}(?::[0-9]{2})?)(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$/.exec(
    value,
  );
  if (dt) return parseIsoTime(dt[1]);

  // Allow HH:MM or HH:MM:SS.
  const m = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(value);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] == null ? 0 : Number(m[3]);
  if (![hour, minute, second].every((x) => Number.isInteger(x))) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;
  return { hour, minute, second };
}

export function toUtcDate(d: ParsedIsoDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

export function utcDaysBetween(start: ParsedIsoDate, end: ParsedIsoDate): number {
  const a = toUtcDate(start).getTime();
  const b = toUtcDate(end).getTime();
  // Both are midnight UTC.
  return Math.trunc((b - a) / 86_400_000);
}

export function wholeMonthsBetween(start: ParsedIsoDate, end: ParsedIsoDate): number {
  let months = (end.year - start.year) * 12 + (end.month - start.month);
  if (end.day < start.day) months -= 1;
  return months;
}

export function wholeYearsBetween(start: ParsedIsoDate, end: ParsedIsoDate): number {
  let years = end.year - start.year;
  if (end.month < start.month || (end.month === start.month && end.day < start.day)) years -= 1;
  return years;
}

export function isoWeekNumber(d: ParsedIsoDate): number {
  // ISO week date algorithm (UTC): week starts Monday; week 1 contains Jan 4.
  const date = toUtcDate(d);
  // Convert Sunday=0..Saturday=6 to Monday=0..Sunday=6
  const day = (date.getUTCDay() + 6) % 7;
  // Move to Thursday of current week
  date.setUTCDate(date.getUTCDate() - day + 3);
  const thursday = date;

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);

  const diff = thursday.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / 86_400_000 / 7);
}

export function weekNumber(d: ParsedIsoDate, weekStartsOn: 0 | 1): number {
  // Non-ISO week numbering: week 1 contains Jan 1.
  const date = toUtcDate(d);
  const startOfYear = new Date(Date.UTC(d.year, 0, 1));
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86_400_000);
  const jan1Day = startOfYear.getUTCDay(); // 0..6
  const offset = (jan1Day - weekStartsOn + 7) % 7;
  return Math.floor((dayOfYear + offset) / 7) + 1;
}
