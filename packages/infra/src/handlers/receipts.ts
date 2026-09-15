import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { deriveRules, isIsoDate, type CategoryRule, type Receipt } from '@bill/shared';
import {
  HttpError,
  callerId,
  jsonBody,
  methodNotAllowed,
  noContent,
  ok,
  pathParam,
  withErrorHandling,
} from '../lib/http.js';
import {
  deleteReceipt,
  deleteRuleByMatchKey,
  getReceipt,
  listReceipts,
  listRules,
  moveReceipt,
  putRule,
} from '../lib/store.js';

/** Fields a client may change. Status and timestamps are the server's to set. */
type ReceiptPatch = Partial<Pick<Receipt, 'merchant' | 'purchasedAt' | 'totalMinor' | 'items' | 'notes' | 'imageKey'>>;

export const handler = withErrorHandling(async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const userId = callerId(event);
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (path.endsWith('/receipts') && method === 'GET') {
    const from = event.queryStringParameters?.from;
    const to = event.queryStringParameters?.to;

    if (from || to) {
      if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
        throw new HttpError(400, 'from and to must both be dates in YYYY-MM-DD form');
      }
      return ok(await listReceipts(userId, { from, to }));
    }
    return ok(await listReceipts(userId));
  }

  const receiptId = pathParam(event, 'id');
  const receipt = await getReceipt(userId, receiptId);
  if (!receipt) throw new HttpError(404, 'No such receipt');

  if (path.endsWith('/confirm') && method === 'POST') {
    return ok(await confirm(userId, receipt));
  }

  if (method === 'GET') return ok(receipt);

  if (method === 'PATCH') {
    const patch = jsonBody<ReceiptPatch>(event);

    if (patch.purchasedAt !== undefined && !isIsoDate(patch.purchasedAt)) {
      throw new HttpError(400, 'purchasedAt must be a date in YYYY-MM-DD form');
    }
    if (patch.totalMinor !== undefined && !Number.isInteger(patch.totalMinor)) {
      throw new HttpError(400, 'totalMinor must be a whole number of pence');
    }
    if (patch.items?.some((item) => !Number.isInteger(item.totalMinor))) {
      throw new HttpError(400, 'Every item total must be a whole number of pence');
    }

    const updated: Receipt = {
      ...receipt,
      ...patch,
      id: receipt.id,
      status: receipt.status,
      createdAt: receipt.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // A changed date moves the sort key, so the write is a delete plus a put.
    return ok(await moveReceipt(userId, receipt.purchasedAt, updated));
  }

  if (method === 'DELETE') {
    await deleteReceipt(userId, receipt);
    return noContent();
  }

  return methodNotAllowed(method, path);
});

/**
 * Mark a receipt reviewed, and learn from whatever the user corrected on it.
 *
 * The derivation itself lives in @bill/shared and is unit tested there, so the rule
 * the browser predicted and the rule the server writes cannot drift apart.
 */
async function confirm(
  userId: string,
  receipt: Receipt,
): Promise<{ receipt: Receipt; rulesLearned: number }> {
  const existing = await listRules(userId);
  const changes = deriveRules(receipt, existing);

  for (const change of changes) {
    if (change.supersedesRuleId) {
      const superseded = existing.find((rule) => rule.id === change.supersedesRuleId);
      // Same match key means the put below overwrites it anyway; this only matters
      // if a future change keys rules differently.
      if (superseded && superseded.matchKey !== change.matchKey) {
        await deleteRuleByMatchKey(userId, superseded.matchKey);
      }
    }

    const rule: CategoryRule = {
      id: `rule_${crypto.randomUUID().slice(0, 12)}`,
      matchKey: change.matchKey,
      sampleText: change.sampleText,
      categoryId: change.categoryId,
      hitCount: 0,
      createdAt: new Date().toISOString(),
    };
    await putRule(userId, rule);
  }

  const confirmed: Receipt = {
    ...receipt,
    status: 'confirmed',
    updatedAt: new Date().toISOString(),
  };
  await moveReceipt(userId, receipt.purchasedAt, confirmed);

  return { receipt: confirmed, rulesLearned: changes.length };
}
