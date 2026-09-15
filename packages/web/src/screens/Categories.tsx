import { useState } from 'react';
import { CHART_PALETTE, type Category } from '@bill/shared';
import { useAppData, useCategoryLookup } from '../lib/store.js';
import { Banner, Button, Card, ColourDot, EmptyState, Field, Spinner } from '../components/ui.js';

export function CategoriesScreen() {
  const { api, categories, rules, loading, error, setCategories, setRules } = useAppData();
  const categoryLookup = useCategoryLookup();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newHint, setNewHint] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const active = [...categories].filter((c) => !c.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const archived = categories.filter((c) => c.archived);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      await api.createCategory({ name, ...(newHint.trim() ? { hint: newHint.trim() } : {}) });
      setCategories(await api.listCategories());
      setNewName('');
      setNewHint('');
      setNotice(`Added "${name}".`);
    });
  }

  async function patch(id: string, update: Partial<Omit<Category, 'id'>>) {
    await run(async () => {
      await api.updateCategory(id, update);
      setCategories(await api.listCategories());
    });
  }

  async function move(id: string, direction: -1 | 1) {
    const index = active.findIndex((category) => category.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= active.length) return;

    const reordered = [...active];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    await run(async () => {
      setCategories(await api.reorderCategories(reordered.map((category) => category.id)));
    });
  }

  async function remove(category: Category) {
    await run(async () => {
      const { archived: wasArchived } = await api.deleteCategory(category.id);
      setCategories(await api.listCategories());
      setNotice(
        wasArchived
          ? `"${category.name}" is used on existing receipts, so it has been archived rather than deleted. Those receipts keep their history.`
          : `Deleted "${category.name}".`,
      );
    });
  }

  if (loading) return <Spinner label="Loading categories" />;
  if (error) return <Banner tone="critical">{error}</Banner>;

  return (
    <div className="screen">
      {notice && <Banner tone="good">{notice}</Banner>}
      {failure && <Banner tone="critical">{failure}</Banner>}

      <Card
        title="Categories"
        subtitle="The hint is given to the reader along with the receipt, so it changes how new items are sorted."
        padded={false}
      >
        <ul className="category-list">
          {active.map((category, index) => (
            <li key={category.id} className="category-row">
              <div className="category-head">
                <ColourDot slot={category.colourSlot} />
                {editing === category.id ? (
                  <input
                    className="category-name-input"
                    defaultValue={category.name}
                    aria-label="Category name"
                    autoFocus
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value && value !== category.name) void patch(category.id, { name: value });
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <button type="button" className="category-name" onClick={() => setEditing(category.id)}>
                    {category.name}
                  </button>
                )}

                <div className="category-buttons">
                  <Button size="sm" variant="ghost" onClick={() => void move(category.id, -1)} disabled={busy || index === 0} aria-label={`Move ${category.name} up`}>
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void move(category.id, 1)} disabled={busy || index === active.length - 1} aria-label={`Move ${category.name} down`}>
                    ↓
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(category)} disabled={busy} aria-label={`Remove ${category.name}`}>
                    Remove
                  </Button>
                </div>
              </div>

              <textarea
                className="category-hint"
                rows={2}
                aria-label={`Hint for ${category.name}`}
                placeholder="What belongs in this category?"
                defaultValue={category.hint ?? ''}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (category.hint ?? '')) void patch(category.id, { hint: value });
                }}
              />

              <div className="colour-picker" role="group" aria-label={`Colour for ${category.name}`}>
                {CHART_PALETTE.map((_, slotIndex) => {
                  const slot = slotIndex + 1;
                  return (
                    <button
                      key={slot}
                      type="button"
                      className={category.colourSlot === slot ? 'swatch is-active' : 'swatch'}
                      style={{ background: `var(--series-${slot})` }}
                      aria-label={`Colour ${slot}`}
                      aria-pressed={category.colourSlot === slot}
                      onClick={() => void patch(category.id, { colourSlot: slot })}
                    />
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Add a category">
        <div className="add-category">
          <Field label="Name" id="new-cat">
            <input id="new-cat" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Baby" />
          </Field>
          <Field label="Hint" id="new-hint" hint="Optional, but it makes the sorting noticeably better.">
            <input
              id="new-hint"
              value={newHint}
              onChange={(e) => setNewHint(e.target.value)}
              placeholder="e.g. nappies, wipes, formula, baby food"
            />
          </Field>
          <Button variant="primary" onClick={() => void addCategory()} disabled={busy || !newName.trim()}>
            Add
          </Button>
        </div>
      </Card>

      {archived.length > 0 && (
        <Card title="Archived" subtitle="Kept because older receipts still use them.">
          <ul className="archived-list">
            {archived.map((category) => (
              <li key={category.id}>
                <ColourDot slot={category.colourSlot} />
                <span>{category.name}</span>
                <Button size="sm" variant="ghost" onClick={() => void patch(category.id, { archived: false })}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Remembered items"
        subtitle="Built from the corrections you make when reviewing a receipt. These are applied before anything is guessed."
        padded={rules.length === 0}
      >
        {rules.length === 0 ? (
          <EmptyState
            title="Nothing remembered yet"
            body="Change an item's category while reviewing a receipt, and it will be sorted that way automatically from then on."
          />
        ) : (
          <ul className="rule-list">
            {rules.map((rule) => {
              const category = categoryLookup.get(rule.categoryId);
              return (
                <li key={rule.id}>
                  <span className="rule-sample">{rule.sampleText}</span>
                  <span className="rule-arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="inline-head">
                    <ColourDot slot={category?.colourSlot ?? 0} />
                    {category?.name ?? 'Deleted category'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Forget ${rule.sampleText}`}
                    onClick={() =>
                      void run(async () => {
                        await api.deleteRule(rule.id);
                        setRules(await api.listRules());
                      })
                    }
                  >
                    Forget
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
