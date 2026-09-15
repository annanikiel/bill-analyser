import { useEffect, useMemo, useState } from 'react';
import {
  formatMoney,
  formatMoneyPlain,
  isIsoDate,
  parseMoneyToMinor,
  reconcile,
  type LineItem,
  type Receipt,
} from '@bill/shared';
import { useActiveCategories, useAppData } from '../lib/store.js';
import { hrefFor, type Route } from '../lib/router.js';
import { Banner, Button, Card, ColourDot, Field, Spinner } from '../components/ui.js';
import { ReceiptPhoto } from '../components/ReceiptPhoto.js';

/** Below this, the model is guessing rather than reading, and the item is flagged. */
const LOW_CONFIDENCE = 0.6;

export function ReviewScreen({ id, navigate }: { id: string; navigate: (route: Route) => void }) {
  const { api, receipts, upsertReceipt, removeReceipt, setRules } = useAppData();
  const categories = useActiveCategories();

  const stored = useMemo(() => receipts.find((receipt) => receipt.id === id), [receipts, id]);
  const [draft, setDraft] = useState<Receipt | null>(stored ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    if (stored && !draft) setDraft(stored);
  }, [stored, draft]);

  useEffect(() => {
    if (stored || !draft) return;
    // Arrived by deep link with nothing in memory; fetch it.
    void api.getReceipt(id).then((receipt) => receipt && setDraft(receipt));
  }, [api, id, stored, draft]);

  if (!draft) return <Spinner label="Loading receipt" />;

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const balance = reconcile(draft);
  const uncategorised = draft.items.filter((item) => item.categoryId === null);
  const flagged = draft.items.filter(
    (item) => item.categoryId === null || (item.source === 'model' && item.confidence < LOW_CONFIDENCE),
  );
  const visibleItems = onlyFlagged ? flagged : draft.items;

  function patchItem(itemId: string, patch: Partial<LineItem>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
          }
        : current,
    );
  }

  function setItemCategory(itemId: string, categoryId: string | null) {
    // Marking the source as 'user' is what makes this a correction worth learning from.
    patchItem(itemId, { categoryId, source: 'user', confidence: 1 });
  }

  function assignAllUncategorised(categoryId: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.categoryId === null
                ? { ...item, categoryId, source: 'user' as const, confidence: 1 }
                : item,
            ),
          }
        : current,
    );
  }

  async function save(): Promise<Receipt | null> {
    if (!draft) return null;
    if (!isIsoDate(draft.purchasedAt)) {
      setError('That purchase date is not a real date.');
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateReceipt(draft.id, {
        merchant: draft.merchant,
        purchasedAt: draft.purchasedAt,
        totalMinor: draft.totalMinor,
        items: draft.items,
        notes: draft.notes,
      });
      upsertReceipt(saved);
      setDraft(saved);
      return saved;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    const saved = await save();
    if (!saved) return;
    setSaving(true);
    try {
      const { receipt, rulesLearned } = await api.confirmReceipt(saved.id);
      upsertReceipt(receipt);
      setDraft(receipt);
      setRules(await api.listRules());
      setNotice(
        rulesLearned === 0
          ? 'Receipt confirmed.'
          : `Confirmed. ${rulesLearned} correction${rulesLearned === 1 ? '' : 's'} will be applied automatically next time.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this receipt? This cannot be undone.')) return;
    await api.deleteReceipt(draft!.id);
    removeReceipt(draft!.id);
    navigate({ name: 'receipts' });
  }

  return (
    <div className="screen">
      <Card
        title="Receipt details"
        actions={
          <span className={`status-pill status-${draft.status}`}>
            {draft.status === 'confirmed'
              ? 'Confirmed'
              : draft.status === 'parsing'
                ? 'Reading…'
                : draft.status === 'failed'
                  ? 'Could not be read'
                  : 'Needs review'}
          </span>
        }
      >
        <div className="detail-grid">
          <Field label="Shop" id="merchant">
            <input
              id="merchant"
              value={draft.merchant}
              onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
            />
          </Field>
          <Field label="Date" id="purchased">
            <input
              id="purchased"
              type="date"
              value={draft.purchasedAt}
              onChange={(e) => setDraft({ ...draft, purchasedAt: e.target.value })}
            />
          </Field>
          <Field label="Total on the receipt" id="total" hint="As printed, including any discounts.">
            <input
              id="total"
              inputMode="decimal"
              defaultValue={formatMoneyPlain(draft.totalMinor)}
              onBlur={(e) => {
                const minor = parseMoneyToMinor(e.target.value);
                if (minor === null) {
                  e.target.value = formatMoneyPlain(draft.totalMinor);
                  return;
                }
                setDraft({ ...draft, totalMinor: minor });
                e.target.value = formatMoneyPlain(minor);
              }}
            />
          </Field>
        </div>
      </Card>

      {draft.status === 'failed' && (
        <Banner tone="critical">
          This receipt could not be read{draft.parseError ? `: ${draft.parseError}` : '.'} The photo
          is still stored, so you can add the items by hand, or delete this and try a clearer photo.
        </Banner>
      )}

      {draft.status === 'parsing' && (
        <Banner tone="info">
          Still reading this receipt. It will fill in by itself — reopen it in a moment.
        </Banner>
      )}

      {draft.imageKey && <ReceiptPhoto receiptId={draft.id} />}

      {!balance.balanced && (
        <Banner tone={Math.abs(balance.differenceMinor) > 500 ? 'warning' : 'info'}>
          The line items add up to {formatMoney(balance.itemsTotalMinor)}, but the receipt says{' '}
          {formatMoney(balance.printedTotalMinor)} — a difference of{' '}
          {formatMoney(Math.abs(balance.differenceMinor))}. That is normal for a basket-wide
          discount; if it is not, a line may have been missed. The difference is counted as
          uncategorised so your totals still match the receipt.
        </Banner>
      )}

      {uncategorised.length > 0 && (
        <Banner tone="warning">
          <span>
            {uncategorised.length === 1
              ? '1 item still needs a category.'
              : `${uncategorised.length} items still need a category.`}
          </span>
          <span className="bulk-assign">
            <label htmlFor="bulk">{uncategorised.length === 1 ? 'Put it in' : 'Put them all in'}</label>
            <select
              id="bulk"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) assignAllUncategorised(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </span>
        </Banner>
      )}

      {notice && <Banner tone="good">{notice}</Banner>}
      {error && <Banner tone="critical">{error}</Banner>}

      <Card
        title={`${draft.items.length} items`}
        subtitle="Change a category and it will be remembered for this item next time."
        actions={
          flagged.length > 0 ? (
            <Button size="sm" variant={onlyFlagged ? 'primary' : 'secondary'} onClick={() => setOnlyFlagged((v) => !v)}>
              {onlyFlagged ? 'Show all' : `Needs a look (${flagged.length})`}
            </Button>
          ) : null
        }
        padded={false}
      >
        <ul className="item-list">
          {visibleItems.map((item) => {
            const lowConfidence = item.source === 'model' && item.confidence < LOW_CONFIDENCE;
            return (
              <li key={item.id} className={item.categoryId === null ? 'item is-uncategorised' : 'item'}>
                <div className="item-main">
                  <input
                    className="item-name"
                    value={item.name}
                    aria-label="Item name"
                    onChange={(e) => patchItem(item.id, { name: e.target.value })}
                  />
                  <p className="item-raw" title="Exactly as printed on the receipt">
                    {item.rawText}
                    {item.quantity > 1 && <span className="item-qty">× {item.quantity}</span>}
                  </p>
                </div>

                <div className="item-controls">
                  <label className="visually-hidden" htmlFor={`cat-${item.id}`}>
                    Category for {item.name}
                  </label>
                  <div className="item-category">
                    <ColourDot
                      slot={categories.find((c) => c.id === item.categoryId)?.colourSlot ?? 0}
                    />
                    <select
                      id={`cat-${item.id}`}
                      value={item.categoryId ?? ''}
                      onChange={(e) => setItemCategory(item.id, e.target.value || null)}
                    >
                      <option value="">Uncategorised</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <input
                    className="item-price"
                    inputMode="decimal"
                    aria-label={`Price for ${item.name}`}
                    defaultValue={formatMoneyPlain(item.totalMinor)}
                    onBlur={(e) => {
                      const minor = parseMoneyToMinor(e.target.value);
                      if (minor === null) {
                        e.target.value = formatMoneyPlain(item.totalMinor);
                        return;
                      }
                      patchItem(item.id, { totalMinor: minor });
                      e.target.value = formatMoneyPlain(minor);
                    }}
                  />
                </div>

                <p className="item-meta">
                  {item.source === 'user' && <span className="tag tag-user">Your choice</span>}
                  {item.source === 'rule' && <span className="tag tag-rule">Remembered</span>}
                  {lowConfidence && <span className="tag tag-low">Unsure</span>}
                </p>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="sticky-actions">
        <Button variant="danger" onClick={remove} disabled={saving}>
          Delete
        </Button>
        <span className="sticky-spacer" />
        {dirty && (
          <Button onClick={() => void save()} disabled={saving}>
            Save
          </Button>
        )}
        {draft.status === 'confirmed' ? (
          <a className="btn btn-primary" href={hrefFor({ name: 'receipts' })}>
            Done
          </a>
        ) : (
          <Button variant="primary" onClick={() => void confirm()} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm receipt'}
          </Button>
        )}
      </div>
    </div>
  );
}
