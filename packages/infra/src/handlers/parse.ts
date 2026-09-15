import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { Receipt } from '@bill/shared';
import { HttpError, callerId, jsonBody, ok, withErrorHandling } from '../lib/http.js';
import { putReceipt } from '../lib/store.js';
import type { ParseJob } from '../lib/parse-job.js';

/**
 * Start reading a receipt, and return immediately.
 *
 * The model call cannot happen here. API Gateway caps an integration at 30 seconds
 * and will not wait longer whatever the Lambda's own timeout says - so a receipt that
 * takes forty seconds to read returns API Gateway's bare "Internal Server Error"
 * while the function is still working away perfectly happily, and the work is thrown
 * away. Long jobs do not belong behind a synchronous HTTP call.
 *
 * So this writes the receipt straight away in 'parsing' state, hands the actual work
 * to a worker invoked asynchronously, and returns. The app polls the receipt until
 * its status changes, which also gives it something honest to show while waiting.
 */

const WORKER_FUNCTION = process.env.PARSE_WORKER_FUNCTION!;
const lambda = new LambdaClient({});

export const handler = withErrorHandling(async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const userId = callerId(event);
  const { imageKey } = jsonBody<{ imageKey?: string }>(event);

  if (!imageKey) throw new HttpError(400, 'imageKey is required');
  // The upload handler only ever issues keys under the caller's own prefix; this
  // refuses a key belonging to anyone else even if one were somehow guessed.
  if (!imageKey.startsWith(`receipts/${userId}/`)) {
    throw new HttpError(403, 'That image does not belong to you');
  }

  const now = new Date().toISOString();
  const receipt: Receipt = {
    id: `rcpt_${crypto.randomUUID().slice(0, 12)}`,
    merchant: 'Reading…',
    // A placeholder date, replaced by whatever the receipt actually says. It only
    // needs to sort sensibly for the few seconds before the worker overwrites it.
    purchasedAt: now.slice(0, 10),
    currency: 'GBP',
    totalMinor: 0,
    items: [],
    status: 'parsing',
    imageKey,
    createdAt: now,
    updatedAt: now,
  };

  await putReceipt(userId, receipt);

  const job: ParseJob = { userId, receiptId: receipt.id, imageKey, createdAt: now };
  await lambda.send(
    new InvokeCommand({
      FunctionName: WORKER_FUNCTION,
      // Fire and forget: the worker reports back by updating the receipt.
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(job)),
    }),
  );

  return ok(receipt, 202);
});
