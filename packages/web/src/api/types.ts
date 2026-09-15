import type { Category, CategoryRule, Receipt, ReceiptId } from '@bill/shared';

/**
 * Everything the UI needs from a backend.
 *
 * The app talks only to this interface, so the mock implementation and the real
 * AWS one are interchangeable and the UI cannot accidentally depend on the mock's
 * synchronous behaviour. Every method is async for that reason, including the ones
 * the mock could answer instantly.
 */
export interface ApiClient {
  listCategories(): Promise<Category[]>;
  createCategory(input: Pick<Category, 'name'> & Partial<Category>): Promise<Category>;
  updateCategory(id: string, patch: Partial<Omit<Category, 'id'>>): Promise<Category>;
  /** Archives rather than deletes when the category is used by existing receipts. */
  deleteCategory(id: string): Promise<{ archived: boolean }>;
  reorderCategories(orderedIds: string[]): Promise<Category[]>;

  listReceipts(): Promise<Receipt[]>;
  getReceipt(id: ReceiptId): Promise<Receipt | null>;
  /**
   * Upload a photo and read it. Resolves once the receipt has been parsed and
   * learned rules have been applied, with status 'needs_review'.
   */
  parseReceipt(image: Blob, onProgress?: (stage: ParseStage) => void): Promise<Receipt>;
  updateReceipt(id: ReceiptId, patch: Partial<Omit<Receipt, 'id'>>): Promise<Receipt>;
  /** Marks reviewed, and turns this receipt's manual corrections into rules. */
  confirmReceipt(id: ReceiptId): Promise<{ receipt: Receipt; rulesLearned: number }>;
  deleteReceipt(id: ReceiptId): Promise<void>;
  /** A displayable URL for a receipt photo; presigned and short-lived in production. */
  getReceiptImageUrl(id: ReceiptId): Promise<string | null>;

  listRules(): Promise<CategoryRule[]>;
  deleteRule(id: string): Promise<void>;
}

export type ParseStage = 'uploading' | 'reading' | 'categorising' | 'done';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
