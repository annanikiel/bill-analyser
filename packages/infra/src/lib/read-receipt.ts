import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
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
import { HttpError } from './http.js';
import { listCategories, listRules, putCategories, putReceipt } from './store.js';

/**
 * Reading a receipt photo and turning it into categorised line items.
 *
 * One model call does OCR, item extraction and categorisation together. Splitting it
 * into OCR-then-classify is the obvious design and the wrong one: a dedicated OCR
 * service returns `WALKERS CHS ON 6PK` faithfully and has no idea what it means, so
 * the classifier on top ends up as a keyword table that needs a new entry for every
 * own-brand abbreviation in the country. A model that reads the abbreviation, expands
 * it, and places it in the user's own categories does the whole job at once.
 *
 * This runs in the worker, not behind the API: see parse.ts for why.
 */

const BUCKET = process.env.PHOTO_BUCKET!;
/*
 * Which model reads the receipts. Set from the deploy workflow, because which
 * Claude models an AWS account may invoke varies: Bedrock gates its newest flagship
 * models per account, so a given account often has the previous generation and not
 * the current one.
 */
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-opus-4-5';

/*
 * A receipt's worth of JSON, with room for a very large shop. Deliberately under the
 * ~16K mark where a non-streaming request starts risking an HTTP timeout.
 */
const MAX_TOKENS = 12_000;

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
skims past the confident ones.

Reply with a single JSON object and nothing else - no preamble, no explanation, no
code fences. It must have exactly this shape:

{
  "merchant": string,
  "purchasedAt": string,        // "YYYY-MM-DD"
  "currency": string,           // e.g. "GBP"
  "totalMinor": integer,        // the printed total, in pence
  "items": [
    {
      "rawText": string,        // verbatim from the receipt
      "name": string,           // expanded, readable
      "quantity": number,
      "totalMinor": integer,    // pence
      "categoryId": string|null,
      "confidence": number      // 0 to 1
    }
  ]
}`;
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

/** Fetch the image, read it, apply learned rules, and store the result. */
export async function parseReceiptImage(
  userId: string,
  receiptId: string,
  imageKey: string,
  createdAt: string,
): Promise<Receipt> {
  const extension = imageKey.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType) throw new HttpError(400, `Cannot read a ${extension} image`);

  const [categories, rules, image] = await Promise.all([
    loadOrSeedCategories(userId),
    listRules(userId),
    s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: imageKey })),
  ]);

  const imageBytes = await image.Body!.transformToByteArray();
  const parsed = await readReceipt(mediaType, Buffer.from(imageBytes).toString('base64'), categories);

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
    id: receiptId,
    merchant: parsed.merchant.trim() === '' ? 'Unknown shop' : parsed.merchant,
    purchasedAt: isIsoDate(parsed.purchasedAt) ? parsed.purchasedAt : todayIso(),
    currency: parsed.currency || 'GBP',
    totalMinor: Math.round(parsed.totalMinor),
    items,
    status: 'needs_review',
    imageKey,
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  console.log('Parsed receipt', {
    receiptId: receipt.id,
    items: items.length,
    fromRules: items.filter((item) => item.source === 'rule').length,
    uncategorised: items.filter((item) => item.categoryId === null).length,
    model: MODEL_ID,
  });

  return putReceipt(userId, receipt);
}

/**
 * Ask the model to read the receipt, and insist on usable JSON coming back.
 *
 * This deliberately does not use structured outputs or the `effort` parameter, even
 * though both would be a better fit on paper. Which Claude model an AWS account can
 * invoke is not ours to choose - Bedrock gates flagship models per account, so this
 * may be running against the current generation or the previous one, and on older
 * versions those two features sat behind beta headers or were absent. A plain
 * request parsed defensively works identically on all of them, and the schema
 * guarantee that gives up is one this handler was re-checking anyway.
 *
 * Retries once on unusable output, quoting the specific problem back.
 */
async function readReceipt(
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  base64Image: string,
  categories: Category[],
): Promise<z.infer<typeof ParsedReceipt>> {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
        { type: 'text', text: 'Read this receipt.' },
      ],
    },
  ];

  let lastProblem = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `That response could not be used: ${lastProblem}. Reply with the JSON object only - no explanation, no code fences.`,
          },
        ],
      });
    }

    const response = await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      system: buildPrompt(categories),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- content blocks vary by model version
      messages: messages as any,
    });

    if (response.stop_reason === 'refusal') {
      throw new HttpError(422, 'That image could not be read. Try a clearer photo.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new HttpError(
        422,
        'That receipt was too long to read in one go. Try photographing it in two halves.',
      );
    }

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

    const candidate = stripFence(text);

    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      lastProblem = 'it was not valid JSON';
      messages.push({ role: 'assistant', content: text });
      continue;
    }

    const result = ParsedReceipt.safeParse(json);
    if (result.success) return result.data;

    lastProblem = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    messages.push({ role: 'assistant', content: text });
  }

  console.error('Could not get usable JSON from the model', { model: MODEL_ID, lastProblem });
  throw new HttpError(502, 'The receipt could not be read. Try again, or use a clearer photo.');
}

/** Models often wrap JSON in a ```json fence despite being asked not to. */
function stripFence(text: string): string {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text.trim());
  if (fenced) return fenced[1]!.trim();

  // Otherwise take the outermost braces, in case a sentence crept in around it.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}
