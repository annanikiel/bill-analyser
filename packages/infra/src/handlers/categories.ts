import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { DEFAULT_CATEGORIES, nextFreeColourSlot, type Category } from '@bill/shared';
import {
  HttpError,
  callerId,
  jsonBody,
  methodNotAllowed,
  ok,
  pathParam,
  withErrorHandling,
} from '../lib/http.js';
import {
  deleteCategory,
  getCategory,
  listCategories,
  listReceipts,
  putCategories,
  putCategory,
} from '../lib/store.js';

const newId = () => `cat_${crypto.randomUUID().slice(0, 12)}`;

/**
 * On a brand new account there are no categories, which would leave the app with an
 * empty dropdown and nothing to categorise into. The first read seeds the defaults.
 */
async function loadOrSeed(userId: string): Promise<Category[]> {
  const existing = await listCategories(userId);
  if (existing.length > 0) return existing;

  const seeded = DEFAULT_CATEGORIES.map((category) => ({ ...category, id: newId() }));
  await putCategories(userId, seeded);
  return seeded;
}

export const handler = withErrorHandling(async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const userId = callerId(event);
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (path.endsWith('/categories/order') && method === 'POST') {
    const { orderedIds } = jsonBody<{ orderedIds: string[] }>(event);
    const categories = await listCategories(userId);
    const position = new Map(orderedIds.map((id, index) => [id, index]));
    const reordered = categories.map((category) => ({
      ...category,
      sortOrder: position.get(category.id) ?? category.sortOrder,
    }));
    await putCategories(userId, reordered);
    return ok(reordered.sort((a, b) => a.sortOrder - b.sortOrder));
  }

  if (path.endsWith('/categories')) {
    if (method === 'GET') return ok(await loadOrSeed(userId));

    if (method === 'POST') {
      const input = jsonBody<Partial<Category> & { name: string }>(event);
      const name = (input.name ?? '').trim();
      if (name === '') throw new HttpError(400, 'A category needs a name');

      const existing = await listCategories(userId);
      if (existing.some((c) => !c.archived && c.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, `There is already a category called "${name}"`);
      }

      const category: Category = {
        id: newId(),
        name,
        colourSlot: input.colourSlot ?? nextFreeColourSlot(existing),
        sortOrder: input.sortOrder ?? existing.length,
        archived: false,
        ...(input.hint ? { hint: input.hint } : {}),
      };
      return ok(await putCategory(userId, category), 201);
    }

    methodNotAllowed(method, path);
  }

  const id = pathParam(event, 'id');
  const category = await getCategory(userId, id);
  if (!category) throw new HttpError(404, 'No such category');

  if (method === 'PATCH') {
    const patch = jsonBody<Partial<Omit<Category, 'id'>>>(event);
    const updated: Category = {
      ...category,
      ...patch,
      // The id is the one field a patch may never move.
      id: category.id,
    };
    return ok(await putCategory(userId, updated));
  }

  if (method === 'DELETE') {
    // Deleting a category that older receipts still reference would rewrite history,
    // turning past spending into "Deleted category". Archive it instead.
    const receipts = await listReceipts(userId);
    const inUse = receipts.some((receipt) => receipt.items.some((item) => item.categoryId === id));

    if (inUse) {
      await putCategory(userId, { ...category, archived: true });
      return ok({ archived: true });
    }

    await deleteCategory(userId, id);
    return ok({ archived: false });
  }

  return methodNotAllowed(method, path);
});
