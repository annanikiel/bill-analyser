import { parseReceiptImage } from '../lib/read-receipt.js';
import { getReceipt, putReceipt } from '../lib/store.js';
import type { ParseJob } from '../lib/parse-job.js';

/**
 * Does the actual reading, out of band.
 *
 * Invoked asynchronously by the parse handler, so it is free to take as long as the
 * model needs. Nothing is waiting on its HTTP response, because there isn't one - it
 * reports by updating the receipt, which the app is polling.
 *
 * It must therefore never throw without recording why: an unhandled failure here
 * would leave the receipt stuck on "Reading…" forever with the reason buried in a
 * log the user cannot see.
 */
export async function handler(job: ParseJob): Promise<void> {
  try {
    await parseReceiptImage(job.userId, job.receiptId, job.imageKey, job.createdAt);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'The receipt could not be read.';
    console.error('Parse failed', { receiptId: job.receiptId, cause });

    const existing = await getReceipt(job.userId, job.receiptId);
    if (!existing) return;

    await putReceipt(job.userId, {
      ...existing,
      status: 'failed',
      // Surfaced in the app, so a failure is something the user can act on or send
      // on, rather than a spinner that never resolves.
      parseError: reason,
      merchant: 'Could not be read',
      updatedAt: new Date().toISOString(),
    });
  }
}
