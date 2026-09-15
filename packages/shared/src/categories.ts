import type { Category } from './types.js';

/**
 * Starting categories. These are a seed, not a fixture - the user renames, reorders,
 * adds and archives them, and everything downstream reads the stored list.
 *
 * The hints are sent to the model as part of the categorisation prompt, so editing
 * a hint immediately changes how new receipts are read.
 */
export const DEFAULT_CATEGORIES: readonly Omit<Category, 'id'>[] = [
  {
    name: 'Main meal ingredients',
    hint: 'Raw and store-cupboard ingredients cooked into a meal: meat, fish, pasta, rice, tins, sauces, stock, spices, oil, flour.',
    colourSlot: 1,
    sortOrder: 0,
    archived: false,
  },
  {
    name: 'Fresh',
    hint: 'Fruit, vegetables, salad, herbs. Loose or bagged, but not cooked or made into a meal.',
    colourSlot: 3,
    sortOrder: 1,
    archived: false,
  },
  {
    name: 'Ready meals',
    hint: 'Anything designed to be heated and eaten as-is: chilled and frozen ready meals, pizzas, sandwiches, soups, meal kits, takeaway.',
    colourSlot: 2,
    sortOrder: 2,
    archived: false,
  },
  {
    name: 'Snacks, crisps & chocolate',
    hint: 'Crisps, chocolate, sweets, biscuits, cereal bars, nuts as a snack, ice cream.',
    colourSlot: 4,
    sortOrder: 3,
    archived: false,
  },
  {
    name: 'Alcohol',
    hint: 'Wine, beer, cider, spirits, pre-mixed drinks.',
    colourSlot: 7,
    sortOrder: 4,
    archived: false,
  },
  {
    name: 'Household items',
    hint: 'Cleaning products, laundry, bin bags, foil, kitchen roll, light bulbs, batteries, and other non-food items for the house.',
    colourSlot: 5,
    sortOrder: 5,
    archived: false,
  },
  {
    name: 'Health',
    hint: 'Medicines, vitamins, supplements, first aid, prescriptions, dental and personal care.',
    colourSlot: 6,
    sortOrder: 6,
    archived: false,
  },
  {
    name: 'Other',
    hint: 'Anything that does not belong in the categories above - including carrier bags and non-grocery one-offs.',
    colourSlot: 8,
    sortOrder: 7,
    archived: false,
  },
];

/**
 * The validated categorical chart palette (slots 1-8), light and dark steps.
 * Slot order is a colour-blindness safety property, not decoration - see docs.
 */
export const CHART_PALETTE: readonly { light: string; dark: string }[] = [
  { light: '#2a78d6', dark: '#3987e5' }, // 1 blue
  { light: '#eb6834', dark: '#d95926' }, // 2 orange
  { light: '#1baf7a', dark: '#199e70' }, // 3 aqua
  { light: '#eda100', dark: '#c98500' }, // 4 yellow
  { light: '#e87ba4', dark: '#d55181' }, // 5 magenta
  { light: '#008300', dark: '#008300' }, // 6 green
  { light: '#4a3aa7', dark: '#9085e9' }, // 7 violet
  { light: '#e34948', dark: '#e66767' }, // 8 red
];

/** Resolve a category's colour slot (1-8) to its CSS custom property name. */
export function colourVarForSlot(slot: number): string {
  const clamped = Math.min(Math.max(Math.trunc(slot), 1), CHART_PALETTE.length);
  return `var(--series-${clamped})`;
}

/**
 * Pick a colour slot for a new category: the lowest slot not already taken, so that
 * the first eight categories never share a colour. Wraps once all eight are used.
 */
export function nextFreeColourSlot(existing: readonly Category[]): number {
  const taken = new Set(existing.filter((c) => !c.archived).map((c) => c.colourSlot));
  for (let slot = 1; slot <= CHART_PALETTE.length; slot += 1) {
    if (!taken.has(slot)) return slot;
  }
  return (existing.length % CHART_PALETTE.length) + 1;
}
