/**
 * Calendar-date helpers for YYYY-MM-DD strings.
 *
 * Everything works in UTC deliberately. A receipt's date is a calendar day, not an
 * instant, and parsing "2026-03-01" with the local timezone can land on 28 February
 * for anyone west of Greenwich - which silently moves spending between months.
 */

export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time)) return false;
  // Rejects impossible dates that Date.parse rolls over, e.g. 2026-02-31.
  return toIsoDate(new Date(time)) === value;
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(parseIsoDate(value).getTime() + days * MS_PER_DAY));
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / MS_PER_DAY);
}

/** Inclusive on both ends, which is what a user means by "1st to 31st". */
export function isWithin(value: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return value >= from && value <= to;
}

export function startOfMonth(value: IsoDate): IsoDate {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: IsoDate): IsoDate {
  const date = parseIsoDate(value);
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

export function addMonths(value: IsoDate, months: number): IsoDate {
  const date = parseIsoDate(value);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  // Clamp to the last day of the target month so 31 Jan - 1 month is 31 Dec, not 3 Mar.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return toIsoDate(target);
}

/** Monday of the week containing the given date. */
export function startOfWeek(value: IsoDate): IsoDate {
  const date = parseIsoDate(value);
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return addDays(value, -daysSinceMonday);
}

export type BucketSize = 'day' | 'week' | 'month';

/** Pick a bucket that gives a readable number of columns for the range length. */
export function chooseBucketSize(from: IsoDate, to: IsoDate): BucketSize {
  const days = daysBetween(from, to);
  if (days <= 14) return 'day';
  if (days <= 92) return 'week';
  return 'month';
}

export function bucketStart(value: IsoDate, size: BucketSize): IsoDate {
  switch (size) {
    case 'day':
      return value;
    case 'week':
      return startOfWeek(value);
    case 'month':
      return startOfMonth(value);
  }
}

/** Every bucket start between from and to, so periods with no spend still appear. */
export function enumerateBuckets(from: IsoDate, to: IsoDate, size: BucketSize): IsoDate[] {
  const buckets: IsoDate[] = [];
  let cursor = bucketStart(from, size);
  while (cursor <= to) {
    buckets.push(cursor);
    cursor = size === 'month' ? addMonths(cursor, 1) : addDays(cursor, size === 'day' ? 1 : 7);
  }
  return buckets;
}

export function formatBucketLabel(value: IsoDate, size: BucketSize, locale = 'en-GB'): string {
  const date = parseIsoDate(value);
  switch (size) {
    case 'day':
      return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    case 'week':
      return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    case 'month':
      return date.toLocaleDateString(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
}

export function formatIsoDateLong(value: IsoDate, locale = 'en-GB'): string {
  return parseIsoDate(value).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
