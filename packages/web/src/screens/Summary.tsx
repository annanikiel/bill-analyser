import { useMemo, useState } from 'react';
import {
  foldTail,
  formatIsoDateLong,
  formatMoney,
  formatMoneyCompact,
  formatMoneyPlain,
  daysBetween,
  summarise,
  todayIso,
  type DateRange,
} from '@bill/shared';
import { useAppData, useCategoryLookup } from '../lib/store.js';
import { hrefFor } from '../lib/router.js';
import { CategoryBarChart, StatTile, TrendChart } from '../components/charts.js';
import { DateRangePicker, RANGE_PRESETS } from '../components/DateRangePicker.js';
import { Banner, Button, Card, ColourDot, EmptyState, Spinner } from '../components/ui.js';

/** Past six segments a stack stops being readable, so the tail folds into "Other". */
const MAX_TREND_SERIES = 6;

export function SummaryScreen() {
  const { receipts, categories, loading, error } = useAppData();
  const categoryLookup = useCategoryLookup();

  const [presetId, setPresetId] = useState<string | null>('this-month');
  const [range, setRange] = useState<DateRange>(() => RANGE_PRESETS[0]!.build(todayIso()));
  const [focusedCategory, setFocusedCategory] = useState<string | null | undefined>(undefined);

  const summary = useMemo(
    () => summarise(receipts, categories, range),
    [receipts, categories, range],
  );

  const trend = useMemo(() => foldTail(summary.byCategory, MAX_TREND_SERIES), [summary.byCategory]);

  const dayCount = daysBetween(range.from, range.to) + 1;
  const perWeek = dayCount > 0 ? Math.round((summary.totalMinor / dayCount) * 7) : 0;

  // Bundling the id with its items keeps the "nothing selected" case (undefined)
  // distinct from "the uncategorised bucket is selected" (null) for the type checker.
  const focus = useMemo(() => {
    if (focusedCategory === undefined) return null;
    const categoryId = focusedCategory;
    return {
      categoryId,
      items: summary.topItems.filter((item) => item.categoryId === categoryId),
    };
  }, [focusedCategory, summary.topItems]);

  if (loading) return <Spinner label="Loading your receipts" />;
  if (error) return <Banner tone="critical">{error}</Banner>;

  return (
    <div className="screen">
      {/* One filter row, above everything it scopes. */}
      <div className="filter-row">
        <DateRangePicker
          range={range}
          presetId={presetId}
          onChange={(nextRange, nextPreset) => {
            setRange(nextRange);
            setPresetId(nextPreset);
            setFocusedCategory(undefined);
          }}
        />
      </div>

      {summary.unreviewedCount > 0 && (
        <Banner
          tone="warning"
          action={
            <a className="btn btn-secondary btn-sm" href={hrefFor({ name: 'receipts' })}>
              Review
            </a>
          }
        >
          {summary.unreviewedCount} receipt{summary.unreviewedCount === 1 ? '' : 's'} in this period
          {summary.unreviewedCount === 1 ? ' is' : ' are'} still waiting to be checked, so
          {summary.unreviewedCount === 1 ? ' it is' : ' they are'} not counted below.
        </Banner>
      )}

      {summary.receiptCount === 0 ? (
        <EmptyState
          title="Nothing recorded in this period"
          body="Change the date range, or scan a receipt to get started."
          action={
            <a className="btn btn-primary" href={hrefFor({ name: 'scan' })}>
              Scan a receipt
            </a>
          }
        />
      ) : (
        <>
          <section className="stat-row">
            <StatTile
              hero
              label={`Spent ${formatIsoDateLong(range.from)} – ${formatIsoDateLong(range.to)}`}
              value={formatMoney(summary.totalMinor)}
              detail={`${summary.receiptCount} receipt${summary.receiptCount === 1 ? '' : 's'}, ${summary.itemCount} items`}
            />
            <StatTile label="Average shop" value={formatMoneyCompact(summary.meanReceiptMinor)} />
            <StatTile label="Roughly per week" value={formatMoneyCompact(perWeek)} detail={`over ${dayCount} days`} />
          </section>

          {summary.uncategorisedMinor > 0 && (
            <Banner tone="info">
              {formatMoney(summary.uncategorisedMinor)} is uncategorised. That includes any gap
              between a receipt&apos;s printed total and its line items, so the categories always add
              up to the headline figure.
            </Banner>
          )}

          <Card
            title="Where the money went"
            subtitle="Select a category to see what is in it."
          >
            <CategoryBarChart
              data={summary.byCategory}
              currency="GBP"
              selectedId={focusedCategory === undefined ? undefined : focusedCategory}
              onSelect={(id) => setFocusedCategory((current) => (current === id ? undefined : id))}
            />
          </Card>

          {focus && (
            <Card
              title={
                <span className="inline-head">
                  <ColourDot
                    slot={
                      focus.categoryId === null
                        ? 8
                        : (categoryLookup.get(focus.categoryId)?.colourSlot ?? 8)
                    }
                  />
                  {focus.categoryId === null
                    ? 'Uncategorised'
                    : (categoryLookup.get(focus.categoryId)?.name ?? 'Category')}
                </span>
              }
              subtitle={`${focus.items.length} distinct item${focus.items.length === 1 ? '' : 's'} in this period`}
              actions={
                <Button size="sm" variant="ghost" onClick={() => setFocusedCategory(undefined)}>
                  Close
                </Button>
              }
            >
              {focus.items.length === 0 ? (
                <p className="chart-empty">Nothing in this category yet.</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col" className="num">Times</th>
                        <th scope="col" className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {focus.items.map((item) => (
                        <tr key={item.name}>
                          <th scope="row">{item.name}</th>
                          <td className="num">{item.occurrences}</td>
                          <td className="num">{formatMoneyPlain(item.totalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          <Card title="Spending over time">
            <TrendChart
              buckets={summary.byBucket}
              series={trend.series}
              bucketSize={summary.bucketSize}
              currency="GBP"
            />
          </Card>

          <Card title="Most spent on" subtitle="Across the whole period, by item.">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="hide-narrow">Category</th>
                    <th scope="col" className="num hide-narrow">Times</th>
                    <th scope="col" className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topItems.slice(0, 15).map((item) => {
                    const category = item.categoryId ? categoryLookup.get(item.categoryId) : undefined;
                    return (
                      <tr key={`${item.name}-${item.categoryId ?? 'none'}`}>
                        <th scope="row">{item.name}</th>
                        <td className="hide-narrow">
                          <span className="inline-head">
                            <ColourDot slot={category?.colourSlot ?? 8} />
                            {category?.name ?? 'Uncategorised'}
                          </span>
                        </td>
                        <td className="num hide-narrow">{item.occurrences}</td>
                        <td className="num">{formatMoneyPlain(item.totalMinor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
