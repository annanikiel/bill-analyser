import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyCompact, parseMoneyToMinor } from './money.js';
import { isUsableMatchKey, normaliseItemKey } from './matching.js';
import {
  addMonths,
  chooseBucketSize,
  daysBetween,
  enumerateBuckets,
  isIsoDate,
  startOfWeek,
} from './dates.js';
import { foldTail, reconcile, summarise } from './summary.js';
import type { Category, Receipt } from './types.js';

describe('parseMoneyToMinor', () => {
  it('parses plain and decorated amounts', () => {
    expect(parseMoneyToMinor('3.49')).toBe(349);
    expect(parseMoneyToMinor('£3.49')).toBe(349);
    expect(parseMoneyToMinor(' 3,49 ')).toBe(349);
    expect(parseMoneyToMinor('12')).toBe(1200);
    expect(parseMoneyToMinor('85p')).toBe(85);
    expect(parseMoneyToMinor('-1.50')).toBe(-150);
  });

  it('rounds to the nearest penny rather than truncating', () => {
    expect(parseMoneyToMinor('0.005')).toBe(1);
    expect(parseMoneyToMinor('1.999')).toBe(200);
  });

  it('rejects input that is not a number', () => {
    expect(parseMoneyToMinor('')).toBeNull();
    expect(parseMoneyToMinor('abc')).toBeNull();
    expect(parseMoneyToMinor('.')).toBeNull();
    expect(parseMoneyToMinor('1.2.3')).toBeNull();
  });
});

describe('money formatting', () => {
  it('formats pence as pounds', () => {
    expect(formatMoney(349)).toBe('£3.49');
    expect(formatMoney(0)).toBe('£0.00');
  });

  it('drops pence once the figure is large enough that they are noise', () => {
    expect(formatMoneyCompact(349)).toBe('£3.49');
    expect(formatMoneyCompact(128_400)).toBe('£1,284');
  });
});

describe('normaliseItemKey', () => {
  it('ignores case, punctuation and word order', () => {
    expect(normaliseItemKey('TESCO SEMI SKIM MILK')).toBe(normaliseItemKey('Milk, Semi-Skim Tesco'));
  });

  it('strips weights, quantities and promotional noise', () => {
    expect(normaliseItemKey('CHEDDAR 400G')).toBe(normaliseItemKey('Cheddar'));
    expect(normaliseItemKey('BANANAS 6PK OFFER')).toBe(normaliseItemKey('bananas'));
    expect(normaliseItemKey('COFFEE 2 CLUBCARD PRICE')).toBe(normaliseItemKey('coffee'));
  });

  it('keeps different products apart', () => {
    expect(normaliseItemKey('WHOLE MILK')).not.toBe(normaliseItemKey('SEMI SKIM MILK'));
  });

  it('flags keys too thin to hang a rule on', () => {
    expect(isUsableMatchKey(normaliseItemKey('500g'))).toBe(false);
    expect(isUsableMatchKey(normaliseItemKey('Cheddar'))).toBe(true);
  });
});

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('not-a-date')).toBe(false);
  });

  it('counts days inclusively of both endpoints when ranged', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });

  it('starts weeks on Monday', () => {
    expect(startOfWeek('2026-09-15')).toBe('2026-09-14'); // a Tuesday
    expect(startOfWeek('2026-09-14')).toBe('2026-09-14');
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07'); // a Sunday
  });

  it('clamps month arithmetic to the end of a short month', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('chooses a bucket that keeps the column count readable', () => {
    expect(chooseBucketSize('2026-09-01', '2026-09-10')).toBe('day');
    expect(chooseBucketSize('2026-07-01', '2026-09-15')).toBe('week');
    expect(chooseBucketSize('2026-01-01', '2026-12-31')).toBe('month');
  });

  it('emits every bucket in range, including empty ones', () => {
    expect(enumerateBuckets('2026-01-01', '2026-03-15', 'month')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });
});

const categories: Category[] = [
  { id: 'fresh', name: 'Fresh', colourSlot: 3, sortOrder: 0, archived: false },
  { id: 'snacks', name: 'Snacks', colourSlot: 4, sortOrder: 1, archived: false },
];

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'r1',
    merchant: 'Test Store',
    purchasedAt: '2026-09-10',
    currency: 'GBP',
    totalMinor: 500,
    status: 'confirmed',
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    items: [
      { id: 'i1', rawText: 'BANANAS', name: 'Bananas', quantity: 1, totalMinor: 200, categoryId: 'fresh', confidence: 0.9, source: 'model' },
      { id: 'i2', rawText: 'CRISPS', name: 'Crisps', quantity: 1, totalMinor: 300, categoryId: 'snacks', confidence: 0.9, source: 'model' },
    ],
    ...overrides,
  };
}

describe('reconcile', () => {
  it('reports a balanced receipt', () => {
    expect(reconcile(receipt()).balanced).toBe(true);
  });

  it('reports the shortfall when lines do not add up to the printed total', () => {
    const result = reconcile(receipt({ totalMinor: 550 }));
    expect(result.differenceMinor).toBe(50);
    expect(result.balanced).toBe(false);
  });
});

describe('summarise', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' };

  it('totals line items by category', () => {
    const summary = summarise([receipt()], categories, range);
    expect(summary.totalMinor).toBe(500);
    expect(summary.receiptCount).toBe(1);
    expect(summary.itemCount).toBe(2);
    expect(summary.byCategory.map((c) => [c.name, c.totalMinor])).toEqual([
      ['Snacks', 300],
      ['Fresh', 200],
    ]);
  });

  it('excludes receipts that have not been reviewed, and says how many', () => {
    const summary = summarise([receipt(), receipt({ id: 'r2', status: 'needs_review' })], categories, range);
    expect(summary.receiptCount).toBe(1);
    expect(summary.unreviewedCount).toBe(1);
    expect(summary.totalMinor).toBe(500);
  });

  it('ignores receipts outside the range', () => {
    const summary = summarise([receipt({ purchasedAt: '2026-08-31' })], categories, range);
    expect(summary.totalMinor).toBe(0);
    expect(summary.receiptCount).toBe(0);
  });

  it('keeps the category breakdown summing to the headline total', () => {
    // Lines add to 500 but the receipt says 560: the 60p gap must not vanish.
    const summary = summarise([receipt({ totalMinor: 560 })], categories, range);
    const breakdown = summary.byCategory.reduce((sum, c) => sum + c.totalMinor, 0);
    expect(breakdown).toBe(summary.totalMinor);
    expect(summary.totalMinor).toBe(560);
    expect(summary.uncategorisedMinor).toBe(60);
  });

  it('puts items with no category into an uncategorised bucket', () => {
    const uncategorised = receipt({
      items: [{ id: 'i3', rawText: '???', name: 'Unknown', quantity: 1, totalMinor: 500, categoryId: null, confidence: 0.1, source: 'model' }],
    });
    const summary = summarise([uncategorised], categories, range);
    expect(summary.uncategorisedMinor).toBe(500);
    expect(summary.byCategory[0]?.name).toBe('Uncategorised');
  });

  it('reports shares that add up to one', () => {
    const summary = summarise([receipt()], categories, range);
    const shareTotal = summary.byCategory.reduce((sum, c) => sum + c.share, 0);
    expect(shareTotal).toBeCloseTo(1, 10);
  });

  it('handles an empty period without dividing by zero', () => {
    const summary = summarise([], categories, range);
    expect(summary.totalMinor).toBe(0);
    expect(summary.meanReceiptMinor).toBe(0);
    expect(summary.byCategory).toEqual([]);
  });
});

describe('foldTail', () => {
  const totals = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
    categoryId: id,
    name: id.toUpperCase(),
    colourSlot: index + 1,
    totalMinor: (5 - index) * 100,
    itemCount: 1,
    share: (5 - index) / 15,
  }));

  it('leaves a short list alone', () => {
    expect(foldTail(totals, 8).series).toHaveLength(5);
  });

  it('rolls the tail into a single Other series without losing money', () => {
    const { series, foldedIds } = foldTail(totals, 3);
    expect(series).toHaveLength(3);
    expect(series[2]?.name).toBe('Other');
    expect(series.reduce((sum, s) => sum + s.totalMinor, 0)).toBe(1500);
    expect(foldedIds).toEqual(new Set(['c', 'd', 'e']));
  });
});
