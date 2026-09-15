/**
 * Core domain model. Shared between the web app and (later) the Lambda handlers,
 * so that a change to the shape of a receipt breaks compilation on both sides.
 *
 * Money is always an integer count of minor units (pence for GBP). Floating point
 * pounds accumulate rounding error across a year of receipts; integers do not.
 */

export type CategoryId = string;
export type ReceiptId = string;

/** How a line item ended up in the category it is in. */
export type CategorySource =
  /** The model guessed it while reading the receipt. */
  | 'model'
  /** A rule learned from a previous correction matched the item text. */
  | 'rule'
  /** The user set it by hand. This always wins and is never overwritten. */
  | 'user';

export type ReceiptStatus =
  /** Uploaded, waiting on the parser. */
  | 'parsing'
  /** Parsed, but the user has not confirmed the categories yet. */
  | 'needs_review'
  /** User has checked it. Counts towards summaries. */
  | 'confirmed'
  /** Parsing failed; the image is kept so it can be retried. */
  | 'failed';

export interface Category {
  id: CategoryId;
  name: string;
  /**
   * Index 1-8 into the validated categorical chart palette. Stored per category
   * rather than derived from position so that a category keeps its colour when
   * the list is reordered or another category is deleted.
   */
  colourSlot: number;
  sortOrder: number;
  /** Archived categories stay on historic receipts but are not offered for new ones. */
  archived: boolean;
  /** Free text shown to the model to sharpen its guesses, e.g. "tins, pasta, rice". */
  hint?: string;
}

export interface LineItem {
  id: string;
  /** Exactly as printed, kept verbatim so rules can match on it and so the user can audit. */
  rawText: string;
  /** Model's expansion of rawText into something readable. Falls back to rawText. */
  name: string;
  quantity: number;
  /** Price for the whole line, after any line-level discount. */
  totalMinor: number;
  categoryId: CategoryId | null;
  /** Model's self-reported confidence, 0-1. Only meaningful when source is 'model'. */
  confidence: number;
  source: CategorySource;
}

export interface Receipt {
  id: ReceiptId;
  merchant: string;
  /** Calendar date of purchase, YYYY-MM-DD. Not a timestamp: receipts are day-grained. */
  purchasedAt: string;
  /** ISO 4217, e.g. "GBP". */
  currency: string;
  /** The total as printed on the receipt. */
  totalMinor: number;
  items: LineItem[];
  status: ReceiptStatus;
  /** S3 object key for the photo. Never a public URL; fetched via a presigned GET. */
  imageKey?: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

/**
 * A correction the user made, generalised so the same item is categorised the same
 * way next time without asking the model. This is the app's entire learning mechanism.
 */
export interface CategoryRule {
  id: string;
  /** Normalised item text (see normaliseItemKey). The lookup key. */
  matchKey: string;
  /** The text as it was when the rule was created, for display. */
  sampleText: string;
  categoryId: CategoryId;
  /** Number of later receipts this rule has categorised. Surfaces which rules matter. */
  hitCount: number;
  createdAt: string;
}

/** The difference between the receipt's printed total and the sum of its line items. */
export interface ReceiptReconciliation {
  itemsTotalMinor: number;
  printedTotalMinor: number;
  differenceMinor: number;
  /** True when the two agree exactly. */
  balanced: boolean;
}
