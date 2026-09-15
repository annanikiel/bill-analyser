import { addDays, todayIso, type Category, type LineItem, type Receipt } from '@bill/shared';

/**
 * Sample data for the mock backend, so the summary screens have something to show
 * before any real receipt exists. Generated from a fixed seed, so reloading the app
 * does not reshuffle the history under you.
 */

/** Mulberry32 - small, fast, and deterministic from a seed. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CatalogueItem {
  /** As printed on a receipt: abbreviated, upper case, occasionally cryptic. */
  raw: string;
  /** What it actually is. */
  name: string;
  /** Typical price range in pence. */
  min: number;
  max: number;
  categoryName: string;
}

const CATALOGUE: CatalogueItem[] = [
  { raw: 'TESCO SEMI SKIM MLK 2PT', name: 'Semi-skimmed milk, 2 pints', min: 130, max: 155, categoryName: 'Main meal ingredients' },
  { raw: 'BRITISH CHICKEN BRST 650G', name: 'Chicken breast fillets, 650g', min: 520, max: 690, categoryName: 'Main meal ingredients' },
  { raw: 'TSC PENNE 500G', name: 'Penne pasta, 500g', min: 75, max: 110, categoryName: 'Main meal ingredients' },
  { raw: 'CHOPPED TOMS 400G', name: 'Chopped tomatoes, 400g tin', min: 45, max: 75, categoryName: 'Main meal ingredients' },
  { raw: 'MATURE CHEDDAR 400G', name: 'Mature cheddar, 400g', min: 310, max: 420, categoryName: 'Main meal ingredients' },
  { raw: 'FREE RANGE EGGS X6', name: 'Free range eggs, 6 pack', min: 185, max: 245, categoryName: 'Main meal ingredients' },
  { raw: 'BASMATI RICE 1KG', name: 'Basmati rice, 1kg', min: 210, max: 320, categoryName: 'Main meal ingredients' },
  { raw: 'OLIVE OIL 500ML', name: 'Olive oil, 500ml', min: 385, max: 560, categoryName: 'Main meal ingredients' },
  { raw: 'SALMON FILLET 240G', name: 'Salmon fillets, 240g', min: 450, max: 620, categoryName: 'Main meal ingredients' },
  { raw: 'GRNLD BUTTER 250G', name: 'Butter, 250g', min: 195, max: 285, categoryName: 'Main meal ingredients' },

  { raw: 'BANANAS LOOSE', name: 'Bananas, loose', min: 60, max: 130, categoryName: 'Fresh' },
  { raw: 'BAGGED SALAD 130G', name: 'Mixed salad bag, 130g', min: 85, max: 145, categoryName: 'Fresh' },
  { raw: 'CHERRY VINE TOMS 330G', name: 'Cherry vine tomatoes, 330g', min: 130, max: 195, categoryName: 'Fresh' },
  { raw: 'BROCCOLI EACH', name: 'Broccoli', min: 55, max: 95, categoryName: 'Fresh' },
  { raw: 'AVOCADO X2', name: 'Avocados, 2 pack', min: 155, max: 235, categoryName: 'Fresh' },
  { raw: 'BLUEBERRIES 150G', name: 'Blueberries, 150g', min: 165, max: 275, categoryName: 'Fresh' },
  { raw: 'CARROTS 1KG', name: 'Carrots, 1kg', min: 55, max: 90, categoryName: 'Fresh' },
  { raw: 'ONIONS 1KG NET', name: 'Onions, 1kg', min: 79, max: 125, categoryName: 'Fresh' },
  { raw: 'CUCUMBER', name: 'Cucumber', min: 55, max: 95, categoryName: 'Fresh' },

  { raw: 'CHICK TIKKA MSALA 400G', name: 'Chicken tikka masala ready meal', min: 285, max: 425, categoryName: 'Ready meals' },
  { raw: 'WOOD FIRED PIZZA MARG', name: 'Margherita pizza', min: 275, max: 450, categoryName: 'Ready meals' },
  { raw: 'MEAL DEAL SANDWICH', name: 'Meal deal sandwich', min: 340, max: 395, categoryName: 'Ready meals' },
  { raw: 'FRSH SOUP TOM BASIL', name: 'Tomato and basil soup', min: 175, max: 260, categoryName: 'Ready meals' },
  { raw: 'KATSU CURRY KIT', name: 'Katsu curry meal kit', min: 395, max: 525, categoryName: 'Ready meals' },

  { raw: 'WALKERS CHS ON 6PK', name: 'Walkers cheese & onion crisps, 6 pack', min: 165, max: 245, categoryName: 'Snacks, crisps & chocolate' },
  { raw: 'DAIRY MILK 110G', name: 'Cadbury Dairy Milk, 110g', min: 135, max: 200, categoryName: 'Snacks, crisps & chocolate' },
  { raw: 'DIGESTIVES 400G', name: 'Digestive biscuits, 400g', min: 115, max: 175, categoryName: 'Snacks, crisps & chocolate' },
  { raw: 'KETTLE CHIPS SEA SLT', name: 'Kettle Chips sea salt', min: 175, max: 265, categoryName: 'Snacks, crisps & chocolate' },
  { raw: 'BEN JERRY 465ML', name: "Ben & Jerry's ice cream, 465ml", min: 395, max: 565, categoryName: 'Snacks, crisps & chocolate' },

  { raw: 'MALBEC 75CL', name: 'Malbec, 75cl', min: 650, max: 1100, categoryName: 'Alcohol' },
  { raw: 'BREWDOG PUNK IPA 4PK', name: 'BrewDog Punk IPA, 4 pack', min: 495, max: 675, categoryName: 'Alcohol' },
  { raw: 'PROSECCO DOC 75CL', name: 'Prosecco, 75cl', min: 700, max: 1150, categoryName: 'Alcohol' },

  { raw: 'FAIRY PLTBS 40S', name: 'Fairy dishwasher tablets, 40s', min: 495, max: 800, categoryName: 'Household items' },
  { raw: 'ANDREX TOILET TISS 9R', name: 'Andrex toilet roll, 9 rolls', min: 495, max: 725, categoryName: 'Household items' },
  { raw: 'BIN LINERS 30L 20S', name: 'Bin liners, 30L, 20 pack', min: 145, max: 235, categoryName: 'Household items' },
  { raw: 'KITCHEN TOWEL 2PK', name: 'Kitchen roll, 2 pack', min: 195, max: 310, categoryName: 'Household items' },
  { raw: 'LAUNDRY LIQ 38W', name: 'Laundry liquid, 38 washes', min: 545, max: 850, categoryName: 'Household items' },

  { raw: 'NUROFEN 200MG 16S', name: 'Nurofen 200mg, 16 tablets', min: 235, max: 365, categoryName: 'Health' },
  { raw: 'VIT D 1000IU 90S', name: 'Vitamin D 1000IU, 90 tablets', min: 295, max: 475, categoryName: 'Health' },
  { raw: 'COLGATE TOTAL 75ML', name: 'Colgate Total toothpaste, 75ml', min: 165, max: 275, categoryName: 'Health' },
  { raw: 'PLASTERS ASSORTED', name: 'Assorted plasters', min: 155, max: 250, categoryName: 'Health' },

  { raw: 'CARRIER BAG', name: 'Carrier bag', min: 30, max: 45, categoryName: 'Other' },
];

const MERCHANTS = [
  { name: 'Tesco Extra', weight: 4, basket: [8, 18] as const },
  { name: "Sainsbury's Local", weight: 3, basket: [3, 8] as const },
  { name: 'Aldi', weight: 3, basket: [6, 14] as const },
  { name: 'Lidl', weight: 2, basket: [6, 14] as const },
  { name: 'Co-op', weight: 2, basket: [2, 6] as const },
  { name: 'M&S Foodhall', weight: 2, basket: [3, 9] as const },
  { name: 'Waitrose', weight: 1, basket: [5, 12] as const },
  { name: 'Boots', weight: 1, basket: [1, 4] as const },
];

/**
 * Build roughly six months of receipts so every date-range preset has data in it.
 * Returns receipts newest-first, matching the order the API hands them back.
 */
export function buildSeedReceipts(categories: readonly Category[], seed = 20260915): Receipt[] {
  const rng = makeRng(seed);
  const categoryIdByName = new Map(categories.map((category) => [category.name, category.id]));
  const merchantPool = MERCHANTS.flatMap((merchant) => Array<typeof merchant>(merchant.weight).fill(merchant));

  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
  const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

  const today = todayIso();
  const receipts: Receipt[] = [];

  // Walk backwards day by day; shop on roughly a third of days.
  for (let dayOffset = 0; dayOffset < 183; dayOffset += 1) {
    if (rng() > 0.34) continue;

    const purchasedAt = addDays(today, -dayOffset);
    const merchant = pick(merchantPool);
    const itemCount = between(merchant.basket[0], merchant.basket[1]);

    const chosen = new Set<CatalogueItem>();
    // Boots sells health and household only - a basket of chicken breast would be odd.
    const pool =
      merchant.name === 'Boots'
        ? CATALOGUE.filter((item) => item.categoryName === 'Health' || item.categoryName === 'Household items')
        : CATALOGUE;
    while (chosen.size < Math.min(itemCount, pool.length)) chosen.add(pick(pool));

    const items: LineItem[] = [...chosen].map((entry, index) => {
      const quantity = rng() > 0.85 ? 2 : 1;
      const unitPrice = between(entry.min, entry.max);
      return {
        id: `seed-${dayOffset}-${index}`,
        rawText: entry.raw,
        name: entry.name,
        quantity,
        totalMinor: unitPrice * quantity,
        categoryId: categoryIdByName.get(entry.categoryName) ?? null,
        confidence: 0.82 + rng() * 0.17,
        source: 'model',
      };
    });

    const totalMinor = items.reduce((sum, item) => sum + item.totalMinor, 0);
    const createdAt = `${purchasedAt}T18:${String(between(10, 59)).padStart(2, '0')}:00Z`;

    receipts.push({
      id: `seed-${purchasedAt}-${receipts.length}`,
      merchant: merchant.name,
      purchasedAt,
      currency: 'GBP',
      totalMinor,
      items,
      status: 'confirmed',
      createdAt,
      updatedAt: createdAt,
    });
  }

  return receipts;
}

/**
 * Receipts the mock parser returns, cycled through on each scan so that trying the
 * capture flow twice does not produce the same basket.
 */
export const MOCK_PARSE_RESULTS: { merchant: string; items: Omit<LineItem, 'id' | 'categoryId' | 'source'>[] }[] = [
  {
    merchant: 'Tesco Extra',
    items: [
      { rawText: 'TESCO SEMI SKIM MLK 2PT', name: 'Semi-skimmed milk, 2 pints', quantity: 1, totalMinor: 145, confidence: 0.96 },
      { rawText: 'BANANAS LOOSE', name: 'Bananas, loose', quantity: 1, totalMinor: 88, confidence: 0.94 },
      { rawText: 'WALKERS CHS ON 6PK', name: 'Walkers cheese & onion crisps, 6 pack', quantity: 1, totalMinor: 195, confidence: 0.91 },
      { rawText: 'BRITISH CHICKEN BRST 650G', name: 'Chicken breast fillets, 650g', quantity: 1, totalMinor: 585, confidence: 0.93 },
      { rawText: 'ANDREX TOILET TISS 9R', name: 'Andrex toilet roll, 9 rolls', quantity: 1, totalMinor: 575, confidence: 0.89 },
      { rawText: 'MALBEC 75CL', name: 'Malbec, 75cl', quantity: 1, totalMinor: 850, confidence: 0.95 },
      { rawText: 'BAGGED SALAD 130G', name: 'Mixed salad bag, 130g', quantity: 1, totalMinor: 110, confidence: 0.88 },
      { rawText: 'CARRIER BAG', name: 'Carrier bag', quantity: 2, totalMinor: 60, confidence: 0.99 },
      // Deliberately low confidence: exercises the "needs a look" affordance.
      { rawText: 'ORG SPLT PEA 500G', name: 'Organic split peas, 500g', quantity: 1, totalMinor: 165, confidence: 0.41 },
    ],
  },
  {
    merchant: 'Boots',
    items: [
      { rawText: 'NUROFEN 200MG 16S', name: 'Nurofen 200mg, 16 tablets', quantity: 1, totalMinor: 299, confidence: 0.97 },
      { rawText: 'VIT D 1000IU 90S', name: 'Vitamin D 1000IU, 90 tablets', quantity: 1, totalMinor: 399, confidence: 0.95 },
      { rawText: 'COLGATE TOTAL 75ML', name: 'Colgate Total toothpaste, 75ml', quantity: 2, totalMinor: 440, confidence: 0.93 },
    ],
  },
  {
    merchant: 'M&S Foodhall',
    items: [
      { rawText: 'KATSU CURRY KIT', name: 'Katsu curry meal kit', quantity: 1, totalMinor: 450, confidence: 0.92 },
      { rawText: 'CHERRY VINE TOMS 330G', name: 'Cherry vine tomatoes, 330g', quantity: 1, totalMinor: 175, confidence: 0.94 },
      { rawText: 'PROSECCO DOC 75CL', name: 'Prosecco, 75cl', quantity: 1, totalMinor: 900, confidence: 0.96 },
      { rawText: 'BEN JERRY 465ML', name: "Ben & Jerry's ice cream, 465ml", quantity: 1, totalMinor: 500, confidence: 0.9 },
      { rawText: 'DIGESTIVES 400G', name: 'Digestive biscuits, 400g', quantity: 1, totalMinor: 145, confidence: 0.87 },
    ],
  },
];
