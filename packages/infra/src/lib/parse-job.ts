/** The payload the parse handler hands to the worker. */
export interface ParseJob {
  userId: string;
  receiptId: string;
  imageKey: string;
  /** Preserved so the finished receipt keeps the time it was scanned. */
  createdAt: string;
}
