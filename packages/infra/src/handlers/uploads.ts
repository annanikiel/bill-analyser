import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError, callerId, jsonBody, ok, pathParam, withErrorHandling } from '../lib/http.js';
import { getReceipt } from '../lib/store.js';

/**
 * Presigned URLs for receipt photos.
 *
 * The browser never holds AWS credentials. It asks for a URL, uploads straight to
 * S3, and the object key it is given always starts with the caller's own user id -
 * taken from the token, so a caller cannot ask for a key under someone else's prefix.
 */

const BUCKET = process.env.PHOTO_BUCKET!;
const s3 = new S3Client({});

/** Long enough for a slow phone upload, short enough that a leaked URL is stale fast. */
const UPLOAD_URL_TTL_SECONDS = 300;
const VIEW_URL_TTL_SECONDS = 300;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export const handler = withErrorHandling(async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const userId = callerId(event);
  const path = event.rawPath;

  if (path.endsWith('/image-url')) {
    const receiptId = pathParam(event, 'id');
    const receipt = await getReceipt(userId, receiptId);
    if (!receipt) throw new HttpError(404, 'No such receipt');
    if (!receipt.imageKey) return ok({ url: null });

    // The key is re-derived from the receipt this user owns, never taken from the
    // request, so there is no way to sign a URL for an arbitrary object.
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: receipt.imageKey }),
      { expiresIn: VIEW_URL_TTL_SECONDS },
    );
    return ok({ url });
  }

  const { contentType } = jsonBody<{ contentType?: string }>(event);
  const type = contentType ?? 'image/jpeg';
  if (!ALLOWED_TYPES.has(type)) {
    throw new HttpError(400, `${type} is not an image format this accepts`);
  }

  const extension = type.split('/')[1] ?? 'jpg';
  const key = `receipts/${userId}/${crypto.randomUUID()}.${extension}`;

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: type }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );

  return ok({ url, key });
});
