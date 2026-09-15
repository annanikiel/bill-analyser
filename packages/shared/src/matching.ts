/**
 * Turning the text printed on a receipt into a stable key, so that a correction the
 * user makes once keeps applying. Grocery receipts print the same product with
 * incidental variation - a weight, a multibuy marker, a trailing price - so the key
 * has to be looser than the raw string but tight enough not to collide.
 */

/** Tokens that appear on receipt lines but say nothing about what the product is. */
const NOISE_TOKENS = new Set([
  'offer', 'offers', 'multibuy', 'clubcard', 'nectar', 'price', 'reduced', 'save',
  'saving', 'was', 'now', 'each', 'ea', 'pk', 'pack', 'x', 'vat', 'std', 'zero',
  'bogof', 'meal', 'deal', 'promo', 'promotion', 'discount',
]);

/**
 * Normalise an item's printed text into a lookup key.
 *
 * Strips case, punctuation, quantities, weights, prices and promotional noise,
 * leaving the words that identify the product. Returns "" when nothing survives,
 * which callers must treat as "do not create a rule for this".
 */
export function normaliseItemKey(rawText: string): string {
  const tokens = rawText
    .toLowerCase()
    // Separators and punctuation become spaces; keep letters, digits and spaces.
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // Drop pure numbers, weights/volumes (500g, 2pt, 1l, 6pk) and noise words.
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !/^\d+(?:kg|g|ml|l|cl|pt|oz|lb|pk|s)$/.test(token))
    .filter((token) => !NOISE_TOKENS.has(token));

  // Sorting makes the key insensitive to word order, which varies between stores
  // for the same product ("MILK SEMI SKIM" vs "SEMI SKIM MILK").
  return [...new Set(tokens)].sort().join(' ');
}

/**
 * Whether a key is specific enough to hang a rule on. A single short token like
 * "m" or "a" would swallow unrelated items.
 */
export function isUsableMatchKey(key: string): boolean {
  return key.length >= 3;
}
