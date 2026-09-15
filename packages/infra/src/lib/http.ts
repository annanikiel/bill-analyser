import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';

/**
 * Request and response plumbing shared by every handler.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * The calling user's id, taken from the verified JWT and from nowhere else.
 *
 * This is the rule the whole data model rests on: because the partition key is
 * derived from the token API Gateway already validated, there is no code path
 * where a caller can name whose data to read or write. A handler bug can return
 * the wrong shape; it cannot return someone else's receipts.
 */
export function callerId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== 'string' || sub === '') {
    // Only reachable if a route were wired up without the authorizer.
    throw new HttpError(401, 'Not signed in');
  }
  return sub;
}

export function jsonBody<T>(event: { body?: string; isBase64Encoded?: boolean }): T {
  if (!event.body) throw new HttpError(400, 'Expected a JSON body');
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Body was not valid JSON');
  }
}

export function pathParam(
  event: { pathParameters?: Record<string, string | undefined> },
  name: string,
): string {
  const value = event.pathParameters?.[name];
  if (!value) throw new HttpError(400, `Missing ${name} in the path`);
  return decodeURIComponent(value);
}

export function ok(body: unknown, status = 200): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    // CORS headers come from the API's own preflight configuration; the origin
    // allow-list lives there rather than being restated in every handler.
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function noContent(): APIGatewayProxyResultV2 {
  return { statusCode: 204, body: '' };
}

/**
 * Wrap a handler so thrown errors become sensible responses instead of a 502.
 *
 * Unexpected errors are logged in full but reported to the browser as a flat
 * "Something went wrong" - an internal message could name a table or a bucket.
 */
export function withErrorHandling<E extends { rawPath?: string }>(
  handler: (event: E) => Promise<APIGatewayProxyResultV2>,
): (event: E) => Promise<APIGatewayProxyResultV2> {
  return async (event) => {
    try {
      return await handler(event);
    } catch (cause) {
      if (cause instanceof HttpError) {
        return ok({ message: cause.message }, cause.status);
      }
      console.error('Unhandled error', { path: event.rawPath, cause });
      return ok({ message: 'Something went wrong' }, 500);
    }
  };
}

/** Reject a route/method combination the handler does not implement. */
export function methodNotAllowed(method: string, path: string): never {
  throw new HttpError(405, `${method} ${path} is not supported`);
}
