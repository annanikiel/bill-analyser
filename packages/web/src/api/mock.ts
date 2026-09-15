import {
  DEFAULT_CATEGORIES,
  applyRules,
  deriveRules,
  nextFreeColourSlot,
  todayIso,
  type Category,
  type CategoryRule,
  type LineItem,
  type Receipt,
  type ReceiptId,
} from '@bill/shared';
import { ApiError, type ApiClient, type ParseStage } from './types.js';
import { MOCK_PARSE_RESULTS, buildSeedReceipts } from './fixtures.js';

/**
 * An in-browser stand-in for the AWS backend.
 *
 * It implements the real learning behaviour - rules are applied on parse and derived
 * on confirm - so the interaction being designed against is the one that will ship.
 * What it fakes is the network, the auth, and the model: parsing returns a canned
 * basket instead of reading the photo.
 *
 * Data lives in localStorage, which means it is per-browser and not shared between
 * devices. That is a property of the mock, not of the design.
 */

const STORAGE_KEY = 'bill-analyser:mock:v1';

interface MockState {
  categories: Category[];
  receipts: Receipt[];
  rules: CategoryRule[];
  /** Index into MOCK_PARSE_RESULTS, so repeat scans differ. */
  parseCursor: number;
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Latency, so the UI's loading states are exercised rather than skipped past. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedState(): MockState {
  const categories: Category[] = DEFAULT_CATEGORIES.map((category) => ({
    ...category,
    id: newId('cat'),
  }));
  return {
    categories,
    receipts: buildSeedReceipts(categories),
    rules: [],
    parseCursor: 0,
  };
}

function loadState(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    // Private browsing, blocked site data, or corrupt JSON. Start clean rather than
    // failing to boot - the mock's data is not precious.
  }
  const fresh = seedState();
  saveState(fresh);
  return fresh;
}

function saveState(state: MockState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable; the session keeps working in memory.
  }
}

export class MockApiClient implements ApiClient {
  private state: MockState = loadState();

  /** Wipe the mock database and reseed. Exposed for the "reset demo data" control. */
  reset(): void {
    this.state = seedState();
    saveState(this.state);
  }

  private commit(): void {
    saveState(this.state);
  }

  private requireCategory(id: string): Category {
    const category = this.state.categories.find((entry) => entry.id === id);
    if (!category) throw new ApiError(`No category ${id}`, 404);
    return category;
  }

  async listCategories(): Promise<Category[]> {
    await delay(60);
    return [...this.state.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async createCategory(input: Pick<Category, 'name'> & Partial<Category>): Promise<Category> {
    await delay(120);
    const name = input.name.trim();
    if (name === '') throw new ApiError('A category needs a name', 400);
    if (this.state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase() && !c.archived)) {
      throw new ApiError(`There is already a category called "${name}"`, 409);
    }

    const category: Category = {
      id: newId('cat'),
      name,
      colourSlot: input.colourSlot ?? nextFreeColourSlot(this.state.categories),
      sortOrder: input.sortOrder ?? this.state.categories.length,
      archived: false,
      ...(input.hint ? { hint: input.hint } : {}),
    };
    this.state.categories.push(category);
    this.commit();
    return category;
  }

  async updateCategory(id: string, patch: Partial<Omit<Category, 'id'>>): Promise<Category> {
    await delay(100);
    const category = this.requireCategory(id);
    Object.assign(category, patch);
    this.commit();
    return category;
  }

  async deleteCategory(id: string): Promise<{ archived: boolean }> {
    await delay(120);
    const inUse = this.state.receipts.some((receipt) =>
      receipt.items.some((item) => item.categoryId === id),
    );

    if (inUse) {
      // Deleting outright would silently rewrite history, so keep it and hide it.
      this.requireCategory(id).archived = true;
      this.commit();
      return { archived: true };
    }

    this.state.categories = this.state.categories.filter((category) => category.id !== id);
    this.state.rules = this.state.rules.filter((rule) => rule.categoryId !== id);
    this.commit();
    return { archived: false };
  }

  async reorderCategories(orderedIds: string[]): Promise<Category[]> {
    await delay(80);
    orderedIds.forEach((id, index) => {
      const category = this.state.categories.find((entry) => entry.id === id);
      if (category) category.sortOrder = index;
    });
    this.commit();
    return this.listCategories();
  }

  async listReceipts(): Promise<Receipt[]> {
    await delay(120);
    return [...this.state.receipts].sort((a, b) =>
      a.purchasedAt === b.purchasedAt
        ? b.createdAt.localeCompare(a.createdAt)
        : b.purchasedAt.localeCompare(a.purchasedAt),
    );
  }

  async getReceipt(id: ReceiptId): Promise<Receipt | null> {
    await delay(60);
    return this.state.receipts.find((receipt) => receipt.id === id) ?? null;
  }

  async parseReceipt(_image: Blob, onProgress?: (stage: ParseStage) => void): Promise<Receipt> {
    onProgress?.('uploading');
    await delay(500);
    onProgress?.('reading');
    await delay(1200);
    onProgress?.('categorising');
    await delay(600);

    const template = MOCK_PARSE_RESULTS[this.state.parseCursor % MOCK_PARSE_RESULTS.length]!;
    this.state.parseCursor += 1;

    // Stand in for what the model returns: a category guess per item, by name.
    const guessed: LineItem[] = template.items.map((item, index) => ({
      ...item,
      id: newId(`item${index}`),
      categoryId: this.guessCategory(item.rawText),
      source: 'model' as const,
    }));

    // Learned rules override the guesses, exactly as they will in production.
    const { items } = applyRules(guessed, this.state.rules);

    const receipt: Receipt = {
      id: newId('rcpt'),
      merchant: template.merchant,
      purchasedAt: todayIso(),
      currency: 'GBP',
      totalMinor: items.reduce((sum, item) => sum + item.totalMinor, 0),
      items,
      status: 'needs_review',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.state.receipts.push(receipt);
    this.commit();
    onProgress?.('done');
    return receipt;
  }

  /**
   * A crude keyword guess standing in for the model. Intentionally imperfect - it
   * leaves some items uncategorised so the review screen has something to do.
   */
  private guessCategory(rawText: string): string | null {
    const text = rawText.toLowerCase();
    const byName = (name: string) =>
      this.state.categories.find((category) => category.name === name && !category.archived)?.id ?? null;

    const table: [RegExp, string][] = [
      [/malbec|ipa|prosecco|wine|beer|gin|vodka|cider/, 'Alcohol'],
      [/crisp|chocolate|dairy milk|digestive|kettle|jerry|walkers/, 'Snacks, crisps & chocolate'],
      [/nurofen|vit |vitamin|colgate|plaster|paracetamol/, 'Health'],
      [/toilet|andrex|fairy|bin liner|kitchen towel|laundry/, 'Household items'],
      [/banana|salad|toms|tomato|broccoli|avocado|blueberr|carrot|onion|cucumber/, 'Fresh'],
      [/curry kit|pizza|sandwich|soup|masala|meal deal/, 'Ready meals'],
      [/milk|chicken|penne|cheddar|eggs|rice|olive oil|salmon|butter/, 'Main meal ingredients'],
      [/carrier bag/, 'Other'],
    ];

    for (const [pattern, name] of table) {
      if (pattern.test(text)) return byName(name);
    }
    return null;
  }

  async updateReceipt(id: ReceiptId, patch: Partial<Omit<Receipt, 'id'>>): Promise<Receipt> {
    await delay(90);
    const index = this.state.receipts.findIndex((receipt) => receipt.id === id);
    if (index === -1) throw new ApiError(`No receipt ${id}`, 404);

    const updated: Receipt = { ...this.state.receipts[index]!, ...patch, id, updatedAt: nowIso() };
    this.state.receipts[index] = updated;
    this.commit();
    return updated;
  }

  async confirmReceipt(id: ReceiptId): Promise<{ receipt: Receipt; rulesLearned: number }> {
    await delay(150);
    const receipt = this.state.receipts.find((entry) => entry.id === id);
    if (!receipt) throw new ApiError(`No receipt ${id}`, 404);

    const changes = deriveRules(receipt, this.state.rules);
    for (const change of changes) {
      if (change.supersedesRuleId) {
        this.state.rules = this.state.rules.filter((rule) => rule.id !== change.supersedesRuleId);
      }
      this.state.rules.push({
        id: newId('rule'),
        matchKey: change.matchKey,
        sampleText: change.sampleText,
        categoryId: change.categoryId,
        hitCount: 0,
        createdAt: nowIso(),
      });
    }

    receipt.status = 'confirmed';
    receipt.updatedAt = nowIso();
    this.commit();
    return { receipt, rulesLearned: changes.length };
  }

  async deleteReceipt(id: ReceiptId): Promise<void> {
    await delay(120);
    this.state.receipts = this.state.receipts.filter((receipt) => receipt.id !== id);
    this.commit();
  }

  async getReceiptImageUrl(): Promise<string | null> {
    // The mock never stored a photo.
    return null;
  }

  async listRules(): Promise<CategoryRule[]> {
    await delay(80);
    return [...this.state.rules].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteRule(id: string): Promise<void> {
    await delay(80);
    this.state.rules = this.state.rules.filter((rule) => rule.id !== id);
    this.commit();
  }
}
