import type { Category, CategoryId, Receipt, ReceiptReconciliation } from './types.js';
import {
  bucketStart,
  chooseBucketSize,
  enumerateBuckets,
  isWithin,
  type BucketSize,
  type IsoDate,
} from './dates.js';
import { sumMinor } from './money.js';

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface CategoryTotal {
  categoryId: CategoryId | null;
  name: string;
  colourSlot: number;
  totalMinor: number;
  itemCount: number;
  /** Fraction of the period's total, 0-1. Zero when the period total is zero. */
  share: number;
}

export interface BucketTotal {
  bucket: IsoDate;
  totalMinor: number;
  /** Total per category within this bucket, keyed by category id ("" for uncategorised). */
  byCategory: Record<string, number>;
}

export interface ItemTotal {
  name: string;
  categoryId: CategoryId | null;
  totalMinor: number;
  /** Number of times this item was bought across the period. */
  occurrences: number;
}

export interface Summary {
  range: DateRange;
  bucketSize: BucketSize;
  totalMinor: number;
  receiptCount: number;
  itemCount: number;
  /** Mean spend per receipt; zero when there are no receipts. */
  meanReceiptMinor: number;
  byCategory: CategoryTotal[];
  byBucket: BucketTotal[];
  topItems: ItemTotal[];
  /** Total on items the user has not categorised yet. */
  uncategorisedMinor: number;
  /** Receipts in range that are still awaiting review, and so excluded from the totals. */
  unreviewedCount: number;
}

const UNCATEGORISED_KEY = '';
const UNCATEGORISED_LABEL = 'Uncategorised';
/** Slot 8 (red) doubles as the uncategorised colour - it should look like something to fix. */
const UNCATEGORISED_SLOT = 8;

/**
 * Only confirmed receipts count towards spending. A receipt still in review has
 * categories the user has not agreed to, and including it would make the numbers
 * change under them as they edit.
 */
export function isCountable(receipt: Receipt): boolean {
  return receipt.status === 'confirmed';
}

export function receiptsInRange(receipts: readonly Receipt[], range: DateRange): Receipt[] {
  return receipts.filter((receipt) => isWithin(receipt.purchasedAt, range.from, range.to));
}

/** Compare a receipt's printed total against the sum of its lines. */
export function reconcile(receipt: Receipt): ReceiptReconciliation {
  const itemsTotalMinor = sumMinor(receipt.items.map((item) => item.totalMinor));
  const differenceMinor = receipt.totalMinor - itemsTotalMinor;
  return {
    itemsTotalMinor,
    printedTotalMinor: receipt.totalMinor,
    differenceMinor,
    balanced: differenceMinor === 0,
  };
}

/**
 * Aggregate receipts into everything the summary screen needs, in one pass over
 * the data so the numbers on the page always agree with each other.
 *
 * Totals are built from line items, not from receipt totals, so that a category
 * breakdown always sums to the headline figure. Where a receipt's lines do not add
 * up to its printed total (a missed line, a whole-basket discount), the difference
 * lands in `uncategorisedMinor` rather than being silently dropped.
 */
export function summarise(
  receipts: readonly Receipt[],
  categories: readonly Category[],
  range: DateRange,
): Summary {
  const inRange = receiptsInRange(receipts, range);
  const countable = inRange.filter(isCountable);
  const bucketSize = chooseBucketSize(range.from, range.to);

  const categoriesById = new Map(categories.map((category) => [category.id, category]));

  const categoryTotals = new Map<string, { totalMinor: number; itemCount: number }>();
  const bucketTotals = new Map<IsoDate, BucketTotal>();
  for (const bucket of enumerateBuckets(range.from, range.to, bucketSize)) {
    bucketTotals.set(bucket, { bucket, totalMinor: 0, byCategory: {} });
  }
  const itemTotals = new Map<string, ItemTotal>();

  let totalMinor = 0;
  let itemCount = 0;

  for (const receipt of countable) {
    const bucket = bucketTotals.get(bucketStart(receipt.purchasedAt, bucketSize));

    for (const item of receipt.items) {
      const key = item.categoryId ?? UNCATEGORISED_KEY;
      const current = categoryTotals.get(key) ?? { totalMinor: 0, itemCount: 0 };
      current.totalMinor += item.totalMinor;
      current.itemCount += 1;
      categoryTotals.set(key, current);

      if (bucket) {
        bucket.totalMinor += item.totalMinor;
        bucket.byCategory[key] = (bucket.byCategory[key] ?? 0) + item.totalMinor;
      }

      const itemKey = `${item.name.toLowerCase()}::${key}`;
      const itemTotal = itemTotals.get(itemKey) ?? {
        name: item.name,
        categoryId: item.categoryId,
        totalMinor: 0,
        occurrences: 0,
      };
      itemTotal.totalMinor += item.totalMinor;
      itemTotal.occurrences += 1;
      itemTotals.set(itemKey, itemTotal);

      totalMinor += item.totalMinor;
      itemCount += 1;
    }

    // Keep the headline honest when the lines do not add up to the printed total.
    const { differenceMinor } = reconcile(receipt);
    if (differenceMinor !== 0) {
      const current = categoryTotals.get(UNCATEGORISED_KEY) ?? { totalMinor: 0, itemCount: 0 };
      current.totalMinor += differenceMinor;
      categoryTotals.set(UNCATEGORISED_KEY, current);
      if (bucket) {
        bucket.totalMinor += differenceMinor;
        bucket.byCategory[UNCATEGORISED_KEY] =
          (bucket.byCategory[UNCATEGORISED_KEY] ?? 0) + differenceMinor;
      }
      totalMinor += differenceMinor;
    }
  }

  const byCategory: CategoryTotal[] = [...categoryTotals.entries()]
    .map(([key, value]) => {
      const category = key === UNCATEGORISED_KEY ? undefined : categoriesById.get(key);
      return {
        categoryId: key === UNCATEGORISED_KEY ? null : key,
        name: category?.name ?? (key === UNCATEGORISED_KEY ? UNCATEGORISED_LABEL : 'Deleted category'),
        colourSlot: category?.colourSlot ?? UNCATEGORISED_SLOT,
        totalMinor: value.totalMinor,
        itemCount: value.itemCount,
        share: totalMinor === 0 ? 0 : value.totalMinor / totalMinor,
      };
    })
    .filter((entry) => entry.totalMinor !== 0 || entry.itemCount > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const topItems = [...itemTotals.values()]
    .sort((a, b) => b.totalMinor - a.totalMinor)
    .slice(0, 25);

  return {
    range,
    bucketSize,
    totalMinor,
    receiptCount: countable.length,
    itemCount,
    meanReceiptMinor: countable.length === 0 ? 0 : Math.round(totalMinor / countable.length),
    byCategory,
    byBucket: [...bucketTotals.values()],
    topItems,
    uncategorisedMinor: categoryTotals.get(UNCATEGORISED_KEY)?.totalMinor ?? 0,
    unreviewedCount: inRange.length - countable.length,
  };
}

/**
 * Reduce a category breakdown to at most `limit` series plus an "Other" roll-up.
 *
 * The stacked chart cannot carry more than the palette's eight slots, and past about
 * six segments a stack stops being readable anyway. Folding the tail is the documented
 * answer; generating more colours is not.
 */
export function foldTail(
  byCategory: readonly CategoryTotal[],
  limit: number,
): { series: CategoryTotal[]; foldedIds: Set<string> } {
  if (byCategory.length <= limit) {
    return { series: [...byCategory], foldedIds: new Set() };
  }

  const head = byCategory.slice(0, limit - 1);
  const tail = byCategory.slice(limit - 1);
  const foldedIds = new Set(tail.map((entry) => entry.categoryId ?? UNCATEGORISED_KEY));
  const tailTotal = sumMinor(tail.map((entry) => entry.totalMinor));

  return {
    series: [
      ...head,
      {
        categoryId: null,
        name: 'Other',
        // Gray, not a palette hue: "Other" is context, not an entity.
        colourSlot: 0,
        totalMinor: tailTotal,
        itemCount: tail.reduce((count, entry) => count + entry.itemCount, 0),
        share: tail.reduce((share, entry) => share + entry.share, 0),
      },
    ],
    foldedIds,
  };
}
