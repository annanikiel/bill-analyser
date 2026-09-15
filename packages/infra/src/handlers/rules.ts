import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  HttpError,
  callerId,
  methodNotAllowed,
  noContent,
  ok,
  pathParam,
  withErrorHandling,
} from '../lib/http.js';
import { deleteRuleByMatchKey, listRules } from '../lib/store.js';

export const handler = withErrorHandling(async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const userId = callerId(event);
  const method = event.requestContext.http.method;

  if (method === 'GET') {
    const rules = await listRules(userId);
    return ok(rules.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  if (method === 'DELETE') {
    const id = pathParam(event, 'id');
    // Rules are stored under their match key, not their id, so the row has to be
    // found first. There are only ever a handful, so this is a cheap lookup.
    const rule = (await listRules(userId)).find((entry) => entry.id === id);
    if (!rule) throw new HttpError(404, 'No such rule');
    await deleteRuleByMatchKey(userId, rule.matchKey);
    return noContent();
  }

  return methodNotAllowed(method, event.rawPath);
});
