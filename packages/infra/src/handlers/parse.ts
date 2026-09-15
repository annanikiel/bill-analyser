import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  DEFAULT_CATEGORIES,
  applyRules,
  isIsoDate,
  todayIso,
  type Category,
  type LineItem,
  type Receipt,
} from '@bill/shared';
import { HttpError, callerId, jsonBody, ok, withErrorHandling } from '../lib/http.js';
import { listCategories, listRules, putCategories, putReceipt } from '../lib/store.js';

/**
 * Read a receipt photo and turn it into categorised line items.
 *
 * One model call does OCR, item extraction and categorisation together. Splitting it
 * into OCR-then-classify is the obvious design and the wrong one: a dedicated OCR
 * service returns `WALKERS CHS ON 6PK` faithfully and has no idea what it means, so
 * the classifier on top ends up as a keyword table that needs a new entry for every
 * own-brand abbreviation in the country. A model that reads the abbreviation, expands
 * it, and places it in the user's own categories does the whole job at once.
 */

const BUCKET = process.env.PHOTO_BUCKET!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-opus-5';

const s3 = new S3Client({});
const anthropic = new AnthropicBedrockMantle({ awsRegion: process.env.AWS_REGION! });

const MEDIA_TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/webp'> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const ParsedItem = z.object({
  rawText: z.string().describe('The line exactly as printed on the receipt, including abbreviations'),
  name: z.string().describe('What the item actually is, written out in full and readable'),
  quantity: z.number().describe('How many of this item, 1 if not stated'),
  totalMinor: z
    .number()
    .int()
    .describe('What this line cost in total, as a whole number of pence. 3.49 is 349'),
  categoryId: z.string().nullable().describe('The id of the best matching category, or null if none fits'),
  confidence: z.number().describe('0 to 1. How sure you are about this line, both the reading and the category'),
});

const ParsedReceipt = z.object({
  merchant: z.string().describe('The shop name'),
  purchasedAt: z.string().describe('Date of purchase as YYYY-MM-DD'),
  currency: z.string().describe('ISO currency code, e.g. GBP'),
  totalMinor: z
    .number()
    .int()
    .describe('The total printed on the receipt, in pence. Not the sum of the lines - what it says'),
  items: z.array(ParsedItem),
});

function buildPrompt(categories: Category[]): string {
  const list = categories
    .filter((category) => !category.archived)
    .map((category) => `- id "${category.id}": ${category.name}${category.hint ? ` — ${category.hint}` : ''}`)
    .join('\n');

  return `You are reading a photograph of a shopping receipt, most often a UK supermarket.

Return every line of the receipt as an item. For each one:

- Put the text exactly as printed in rawText, abbreviations and all. Do not tidy it.
- Expand it into a readable product name in name. "TESCO SEMI SKIM MLK 2PT" becomes
  "Semi-skimmed milk, 2 pints". Use the shop and the rest of the basket as context
  when an abbreviation is ambiguous.
- Put prices in whole pence as integers. £3.49 is 349. Never use decimals.
- If a line is a discount or a voucher, give it a negative totalMinor and categorise
  it with whatever it applies to if that is clear, otherwise leave categoryId null.
- Skip lines that are not purchases: subtotals, change, card details, loyalty point
  balances, the store address, VAT summaries.
- totalMinor at the top level is the total printed on the receipt. Do not compute it
  by adding the lines up, and do not adjust it to make it match them. If they differ
  that is useful information.
- purchasedAt is the date on the receipt. If it is not legible, use today's date.

Sort each item into exactly one of these categories, by id:

${list}

Use categoryId null when nothing genuinely fits rather than forcing a guess into the
nearest category. Set confidence honestly: below 0.5 when the text is hard to read or
the category is a coin toss, high only when both the reading and the category are
clear. A confident wrong answer costs more than an uncertain one, because the user
skims past the confident ones.`;
}

async function loadOrSeedCategories(userId: string): Promise<Category[]> {
  const existing = await listCategories(userId);
  if (existing.length > 0) return existing;
  const seeded = DEFAULT_CATEGORIES.map((category) => ({
    ...category,
    id: `cat_${crypto.randomUUID().slice(0, 12)}`,
  }));
  await putCategories(userId, seeded);
  return seeded;
}

export const handler = withErrorHandling(async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const userId = callerId(event);
  const { imageKey } = jsonBody<{ imageKey?: string }>(event);

  if (!imageKey) throw new HttpError(400, 'imageKey is required');
  // The upload handler only ever issues keys under the caller's own prefix; this
  // refuses a key belonging to anyone else even if one were somehow guessed.
  if (!imageKey.startsWith(`receipts/${userId}/`)) {
    throw new HttpError(403, 'That image does not belong to you');
  }

  const extension = imageKey.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType) throw new HttpError(400, `Cannot read a ${extension} image`);

  const [categories, rules, image] = await Promise.all([
    loadOrSeedCategories(userId),
    listRules(userId),
    s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: imageKey })),
  ]);

  const imageBytes = await image.Body!.transformToByteArray();

  const response = await anthropic.messages.parse({
    model: MODEL_ID,
    max_tokens: 16000,
    // Reading a receipt is perception and classification, not a reasoning problem.
    // Thinking stays on - disabling it on this model risks stray tags in the output -
    // but at low effort, which keeps both the cost and the wait down. Raise this if
    // long or crumpled receipts start coming back wrong.
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: zodOutputFormat(ParsedReceipt),
    },
    system: buildPrompt(categories),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: Buffer.from(imageBytes).toString('base64'),
            },
          },
          { type: 'text', text: 'Read this receipt.' },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    // Vanishingly unlikely for a receipt, but the alternative is reading content
    // off a response that has none.
    throw new HttpError(422, 'That image could not be read. Try a clearer photo.');
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new HttpError(502, 'The receipt could not be read. Try again.');

  const validCategoryIds = new Set(categories.map((category) => category.id));

  const guessed: LineItem[] = parsed.items.map((item) => ({
    id: `item_${crypto.randomUUID().slice(0, 12)}`,
    rawText: item.rawText,
    name: item.name.trim() === '' ? item.rawText : item.name,
    quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? Math.round(item.quantity) : 1,
    totalMinor: Math.round(item.totalMinor),
    // A hallucinated category id would render as "Deleted category" forever.
    categoryId: item.categoryId && validCategoryIds.has(item.categoryId) ? item.categoryId : null,
    confidence: Math.min(Math.max(item.confidence, 0), 1),
    source: 'model' as const,
  }));

  // Anything the user has corrected before is settled here, for free, before any of
  // the model's guesses are accepted.
  const { items } = applyRules(guessed, rules);

  const receipt: Receipt = {
    id: `rcpt_${crypto.randomUUID().slice(0, 12)}`,
    merchant: parsed.merchant.trim() === '' ? 'Unknown shop' : parsed.merchant,
    purchasedAt: isIsoDate(parsed.purchasedAt) ? parsed.purchasedAt : todayIso(),
    currency: parsed.currency || 'GBP',
    totalMinor: Math.round(parsed.totalMinor),
    items,
    status: 'needs_review',
    imageKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  console.log('Parsed receipt', {
    receiptId: receipt.id,
    items: items.length,
    fromRules: items.filter((item) => item.source === 'rule').length,
    uncategorised: items.filter((item) => item.categoryId === null).length,
    usage: response.usage,
  });

  return ok(await putReceipt(userId, receipt), 201);
});
