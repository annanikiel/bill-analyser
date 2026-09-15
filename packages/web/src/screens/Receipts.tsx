import { useMemo, useState } from 'react';
import { formatIsoDateLong, formatMoney } from '@bill/shared';
import { useAppData } from '../lib/store.js';
import { hrefFor } from '../lib/router.js';
import { Banner, EmptyState, Spinner } from '../components/ui.js';
import type { ReceiptStatus } from '@bill/shared';

const STATUS_LABEL: Record<ReceiptStatus, string> = {
  parsing: 'Reading…',
  needs_review: 'Needs review',
  confirmed: 'Confirmed',
  failed: 'Could not be read',
};

export function ReceiptsScreen() {
  const { receipts, loading, error } = useAppData();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return receipts;
    return receipts.filter(
      (receipt) =>
        receipt.merchant.toLowerCase().includes(needle) ||
        receipt.items.some((item) => item.name.toLowerCase().includes(needle)),
    );
  }, [receipts, query]);

  const pending = receipts.filter((receipt) => receipt.status === 'needs_review');

  if (loading) return <Spinner label="Loading your receipts" />;
  if (error) return <Banner tone="critical">{error}</Banner>;

  return (
    <div className="screen">
      <div className="filter-row">
        <input
          type="search"
          className="search-input"
          placeholder="Search shops and items"
          aria-label="Search receipts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {pending.length > 0 && query === '' && (
        <Banner tone="warning">
          {pending.length} receipt{pending.length === 1 ? '' : 's'} waiting to be checked.
        </Banner>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={query ? 'Nothing matches that search' : 'No receipts yet'}
          body={query ? 'Try a shop name or an item.' : 'Scan one to get started.'}
          action={
            query ? null : (
              <a className="btn btn-primary" href={hrefFor({ name: 'scan' })}>
                Scan a receipt
              </a>
            )
          }
        />
      ) : (
        <ul className="receipt-list">
          {filtered.map((receipt) => (
            <li key={receipt.id}>
              <a className="receipt-card" href={hrefFor({ name: 'receipt', id: receipt.id })}>
                <span className="receipt-merchant">{receipt.merchant}</span>
                <span className="receipt-date">{formatIsoDateLong(receipt.purchasedAt)}</span>
                <span className="receipt-items">
                  {receipt.items.length} item{receipt.items.length === 1 ? '' : 's'}
                </span>
                <span className="receipt-total">{formatMoney(receipt.totalMinor, receipt.currency)}</span>
                {receipt.status !== 'confirmed' && (
                  <span className={`status-pill status-${receipt.status}`}>
                    {STATUS_LABEL[receipt.status]}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
