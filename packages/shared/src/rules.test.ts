import { describe, expect, it } from 'vitest';
import { applyRules, deriveRules } from './rules.js';
import { normaliseItemKey } from './matching.js';
import type { CategoryRule, LineItem, Receipt } from './types.js';

function item(overrides: Partial<LineItem> = {}): LineItem {
  return {
    id: 'i1',
    rawText: 'ORG SPLT PEA 500G',
    name: 'Organic split peas',
    quantity: 1,
    totalMinor: 165,
    categoryId: null,
    confidence: 0.4,
    source: 'model',
    ...overrides,
  };
}

function rule(overrides: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: 'rule1',
    matchKey: normaliseItemKey('ORG SPLT PEA 500G'),
    sampleText: 'ORG SPLT PEA 500G',
    categoryId: 'main',
    hitCount: 0,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function receipt(items: LineItem[]): Receipt {
  return {
    id: 'r1',
    merchant: 'Tesco',
    purchasedAt: '2026-09-15',
    currency: 'GBP',
    totalMinor: 165,
    items,
    status: 'needs_review',
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
  };
}

describe('applyRules', () => {
  it('categorises an item a rule matches', () => {
    const { items } = applyRules([item()], [rule()]);
    expect(items[0]?.categoryId).toBe('main');
    expect(items[0]?.source).toBe('rule');
    expect(items[0]?.confidence).toBe(1);
  });

  it('matches despite case, punctuation, weight and word order', () => {
    const { items } = applyRules([item({ rawText: 'splt ORG. pea 1KG' })], [rule()]);
    expect(items[0]?.categoryId).toBe('main');
  });

  it('does not match a different abbreviation of the same product', () => {
    // The normaliser strips noise but does not stem, so "SPLT" and "Split" are
    // separate keys. A new spelling falls through to the model rather than being
    // guessed at from a rule, and correcting it once adds a rule of its own.
    const { items } = applyRules([item({ rawText: 'Organic Split Peas 500g' })], [rule()]);
    expect(items[0]?.categoryId).toBeNull();
  });

  it('overrides a model guess', () => {
    const guessed = item({ categoryId: 'snacks', source: 'model', confidence: 0.9 });
    const { items } = applyRules([guessed], [rule()]);
    expect(items[0]?.categoryId).toBe('main');
  });

  it('never overrides a choice the user made on this receipt', () => {
    const chosen = item({ categoryId: 'snacks', source: 'user', confidence: 1 });
    const { items } = applyRules([chosen], [rule()]);
    expect(items[0]?.categoryId).toBe('snacks');
    expect(items[0]?.source).toBe('user');
  });

  it('leaves unmatched items alone and reports which rules fired', () => {
    const { items, matchedRuleIds } = applyRules([item({ rawText: 'BANANAS' })], [rule()]);
    expect(items[0]?.categoryId).toBeNull();
    expect(items[0]?.source).toBe('model');
    expect(matchedRuleIds).toEqual([]);
  });
});

describe('deriveRules', () => {
  it('learns from a correction the user made', () => {
    const changes = deriveRules(receipt([item({ categoryId: 'main', source: 'user' })]), []);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.categoryId).toBe('main');
    expect(changes[0]?.sampleText).toBe('ORG SPLT PEA 500G');
  });

  it('does not learn from a guess the user merely accepted', () => {
    // Silence is weaker evidence than correction; learning from it would freeze
    // the model's mistakes in place.
    expect(deriveRules(receipt([item({ categoryId: 'main', source: 'model' })]), [])).toEqual([]);
    expect(deriveRules(receipt([item({ categoryId: 'main', source: 'rule' })]), [])).toEqual([]);
  });

  it('does not learn from an item the user left uncategorised', () => {
    expect(deriveRules(receipt([item({ categoryId: null, source: 'user' })]), [])).toEqual([]);
  });

  it('skips items whose text is too thin to match on safely', () => {
    const thin = item({ rawText: '2 @ 1.50', categoryId: 'main', source: 'user' });
    expect(deriveRules(receipt([thin]), [])).toEqual([]);
  });

  it('does nothing when a rule already says the same thing', () => {
    const corrected = item({ categoryId: 'main', source: 'user' });
    expect(deriveRules(receipt([corrected]), [rule()])).toEqual([]);
  });

  it('supersedes the old rule when the user changes their mind', () => {
    const corrected = item({ categoryId: 'snacks', source: 'user' });
    const changes = deriveRules(receipt([corrected]), [rule()]);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.categoryId).toBe('snacks');
    expect(changes[0]?.supersedesRuleId).toBe('rule1');
  });

  it('emits one rule per item even when a receipt lists it twice', () => {
    const changes = deriveRules(
      receipt([
        item({ id: 'a', categoryId: 'main', source: 'user' }),
        item({ id: 'b', categoryId: 'main', source: 'user' }),
      ]),
      [],
    );
    expect(changes).toHaveLength(1);
  });
});
