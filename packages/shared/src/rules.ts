import type { CategoryRule, LineItem, Receipt } from './types.js';
import { isUsableMatchKey, normaliseItemKey } from './matching.js';

/**
 * The learning loop, as two pure functions.
 *
 * `applyRules` runs before the model sees an item, so anything the user has already
 * corrected is settled for free and never gets re-guessed. `deriveRules` runs when a
 * receipt is confirmed, turning this session's corrections into next time's answers.
 *
 * Both live here rather than in the client or a Lambda so the rule that categorised
 * an item is identical wherever it ran.
 */

/**
 * Apply learned rules to a set of freshly parsed items.
 *
 * A rule overrides a model guess but never a user's own choice on this receipt.
 */
export function applyRules(
  items: readonly LineItem[],
  rules: readonly CategoryRule[],
): { items: LineItem[]; matchedRuleIds: string[] } {
  const byKey = new Map(rules.map((rule) => [rule.matchKey, rule]));
  const matchedRuleIds: string[] = [];

  const applied = items.map((item) => {
    if (item.source === 'user') return item;

    const rule = byKey.get(normaliseItemKey(item.rawText));
    if (!rule) return item;

    matchedRuleIds.push(rule.id);
    return {
      ...item,
      categoryId: rule.categoryId,
      source: 'rule' as const,
      // A rule is a decision the user already made, so it is not a guess.
      confidence: 1,
    };
  });

  return { items: applied, matchedRuleIds };
}

export interface RuleChange {
  matchKey: string;
  sampleText: string;
  categoryId: string;
  /** The rule this replaces, when the user has changed their mind about an item. */
  supersedesRuleId?: string;
}

/**
 * Work out which rules a confirmed receipt should create or update.
 *
 * Only items the user touched by hand produce rules - agreeing with the model by
 * saying nothing is weaker evidence than correcting it, and turning every accepted
 * guess into a rule would freeze the model's mistakes in place.
 */
export function deriveRules(
  receipt: Receipt,
  existingRules: readonly CategoryRule[],
): RuleChange[] {
  const byKey = new Map(existingRules.map((rule) => [rule.matchKey, rule]));
  const changes = new Map<string, RuleChange>();

  for (const item of receipt.items) {
    if (item.source !== 'user' || item.categoryId === null) continue;

    const matchKey = normaliseItemKey(item.rawText);
    if (!isUsableMatchKey(matchKey)) continue;

    const existing = byKey.get(matchKey);
    if (existing && existing.categoryId === item.categoryId) continue;

    changes.set(matchKey, {
      matchKey,
      sampleText: item.rawText,
      categoryId: item.categoryId,
      ...(existing ? { supersedesRuleId: existing.id } : {}),
    });
  }

  return [...changes.values()];
}
