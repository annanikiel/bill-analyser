/** Money helpers. All amounts are integer minor units (pence for GBP). */

const MINOR_UNITS_PER_MAJOR = 100;

/** Parse user input like "3.49", "£3.49", "3,49" or "349p" into pence. */
export function parseMoneyToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/[£$€\s]/g, '');
  if (cleaned === '') return null;

  const penceSuffix = /^(-?\d+)p$/i.exec(cleaned);
  if (penceSuffix) return Number.parseInt(penceSuffix[1]!, 10);

  // Accept both "." and "," as the decimal separator; reject anything else.
  const normalised = cleaned.replace(',', '.');
  if (!/^-?\d*\.?\d*$/.test(normalised) || normalised === '.' || normalised === '-') return null;

  const value = Number.parseFloat(normalised);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * MINOR_UNITS_PER_MAJOR);
}

/** Format pence as a currency string, e.g. 349 -> "£3.49". */
export function formatMoney(minor: number, currency = 'GBP', locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(minor / MINOR_UNITS_PER_MAJOR);
}

/** Format pence with no currency symbol, for table columns: 349 -> "3.49". */
export function formatMoneyPlain(minor: number, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / MINOR_UNITS_PER_MAJOR);
}

/**
 * Compact form for chart axes and stat tiles: 1284 -> "£12.84", 1284_00 -> "£1,284".
 * Drops the pence once the number is big enough that they are noise.
 */
export function formatMoneyCompact(minor: number, currency = 'GBP', locale = 'en-GB'): string {
  const major = minor / MINOR_UNITS_PER_MAJOR;
  const showPence = Math.abs(major) < 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: showPence ? 2 : 0,
    maximumFractionDigits: showPence ? 2 : 0,
  }).format(major);
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
