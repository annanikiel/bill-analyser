import { useState } from 'react';
import { useAppData } from '../lib/store.js';
import { Button, Card } from './ui.js';

/**
 * The original photo, fetched on demand.
 *
 * The URL is presigned and short-lived, and is only minted after the server has
 * confirmed the receipt belongs to you - so it is requested when you ask to see the
 * photo rather than eagerly on every receipt you open.
 */
export function ReceiptPhoto({ receiptId }: { receiptId: string }) {
  const { api } = useAppData();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getReceiptImageUrl(receiptId);
      if (!next) setError('The photo is no longer stored. Photos are kept for 30 days.');
      setUrl(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the photo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      title="Original photo"
      actions={
        url ? (
          <Button size="sm" variant="ghost" onClick={() => setUrl(null)}>
            Hide
          </Button>
        ) : (
          <Button size="sm" onClick={() => void show()} disabled={loading}>
            {loading ? 'Loading…' : 'Show'}
          </Button>
        )
      }
    >
      <div className="photo-panel">
        {url && <img src={url} alt="The original receipt" />}
        {error && <p className="photo-note">{error}</p>}
        {!url && !error && (
          <p className="photo-note">
            Useful for checking a line you are unsure about. Photos are deleted 30 days
            after they are taken.
          </p>
        )}
      </div>
    </Card>
  );
}
