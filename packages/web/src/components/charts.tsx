import { useId, useMemo, useState } from 'react';
import {
  formatBucketLabel,
  formatMoney,
  formatMoneyCompact,
  formatMoneyPlain,
  type BucketTotal,
  type CategoryTotal,
  type BucketSize,
} from '@bill/shared';
import { ColourDot } from './ui.js';
import { useMediaQuery } from '../lib/useMediaQuery.js';

/**
 * Charts are hand-rolled SVG rather than a charting library: the specs here (thin
 * marks, 2px surface gaps, rounded data-ends, selective direct labels) are easier to
 * hit exactly than to configure out of a library's defaults, and it keeps the bundle
 * small enough to matter on a phone.
 *
 * Every chart ships a table view. Three of the light-mode palette slots sit below
 * 3:1 contrast against the surface, so colour is never the only way to read a value.
 */

function colourFor(slot: number): string {
  return slot === 0 ? 'var(--series-0)' : `var(--series-${slot})`;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; slot: number }[];
}

function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  return (
    <div className="chart-tooltip" style={{ left: state.x, top: state.y }} role="presentation">
      <p className="chart-tooltip-title">{state.title}</p>
      {state.rows.map((row) => (
        <p key={row.label} className="chart-tooltip-row">
          <span className="chart-tooltip-key" style={{ background: colourFor(row.slot) }} />
          {/* Value leads: the reader already knows which series they are pointing at. */}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </p>
      ))}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="View as">
      <button
        type="button"
        className={view === 'chart' ? 'is-active' : undefined}
        aria-pressed={view === 'chart'}
        onClick={() => onChange('chart')}
      >
        Chart
      </button>
      <button
        type="button"
        className={view === 'table' ? 'is-active' : undefined}
        aria-pressed={view === 'table'}
        onClick={() => onChange('table')}
      >
        Table
      </button>
    </div>
  );
}

/**
 * Spend by category: a horizontal bar chart, one hue for every bar.
 *
 * The category name is already on the axis, so colouring each bar by its category
 * would spend the colour channel restating the label. The identity colours earn
 * their place in the trend chart below, where colour is the only identity channel.
 */
export function CategoryBarChart({
  data,
  currency,
  onSelect,
  selectedId,
}: {
  data: readonly CategoryTotal[];
  currency: string;
  onSelect?: (categoryId: string | null) => void;
  selectedId?: string | null;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const max = useMemo(() => Math.max(1, ...data.map((entry) => Math.abs(entry.totalMinor))), [data]);

  if (data.length === 0) {
    return <p className="chart-empty">No spending in this period.</p>;
  }

  return (
    <div className="chart-block">
      <div className="chart-head">
        <ViewToggle view={view} onChange={setView} />
      </div>

      {view === 'chart' ? (
        <div className="bar-chart" onPointerLeave={() => setTooltip(null)}>
          {data.map((entry) => {
            const key = entry.categoryId ?? 'uncategorised';
            const widthPercent = Math.max(0, (entry.totalMinor / max) * 100);
            const selected = selectedId !== undefined && selectedId === entry.categoryId;
            return (
              <button
                key={key}
                type="button"
                className={['bar-row', selected ? 'is-selected' : '', onSelect ? '' : 'is-static']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect?.(entry.categoryId)}
                onPointerMove={(event) => {
                  const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
                  setTooltip({
                    x: event.clientX - bounds.left,
                    y: event.clientY - bounds.top,
                    title: entry.name,
                    rows: [
                      { label: `${Math.round(entry.share * 100)}% of spend`, value: formatMoney(entry.totalMinor, currency), slot: 1 },
                      { label: entry.itemCount === 1 ? 'item' : 'items', value: String(entry.itemCount), slot: 1 },
                    ],
                  });
                }}
                onFocus={() => setTooltip(null)}
              >
                <span className="bar-label">{entry.name}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${widthPercent}%` }} />
                </span>
                {/* Direct label at the tip: the axis it replaces would be less precise. */}
                <span className="bar-value">{formatMoneyCompact(entry.totalMinor, currency)}</span>
              </button>
            );
          })}
          <Tooltip state={tooltip} />
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Spending by category</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="num">Items</th>
                <th scope="col" className="num">Share</th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.categoryId ?? 'uncategorised'}>
                  <th scope="row">{entry.name}</th>
                  <td className="num">{entry.itemCount}</td>
                  <td className="num">{Math.round(entry.share * 100)}%</td>
                  <td className="num">{formatMoneyPlain(entry.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Spend over time as a stacked column per period.
 *
 * Series are capped at the palette's safe range and the tail is folded into "Other"
 * by the caller. Each segment keeps its category's own colour slot, so filtering the
 * range never repaints the categories that survive.
 */
export function TrendChart({
  buckets,
  series,
  bucketSize,
  currency,
}: {
  buckets: readonly BucketTotal[];
  series: readonly CategoryTotal[];
  bucketSize: BucketSize;
  currency: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const titleId = useId();
  const narrow = useMediaQuery('(max-width: 560px)');

  /*
   * Label every Nth column rather than all of them. Date ticks collide long before
   * the columns do, and the tooltip carries the exact period anyway - so aim for a
   * readable handful and let the axis stop trying to name every bar.
   */
  const tickStep = Math.max(1, Math.ceil(buckets.length / (narrow ? 5 : 10)));

  const max = useMemo(
    () => Math.max(1, ...buckets.map((bucket) => Math.max(0, bucket.totalMinor))),
    [buckets],
  );

  const foldedKeys = useMemo(
    () => new Set(series.map((entry) => entry.categoryId ?? '')),
    [series],
  );

  if (buckets.length === 0) return <p className="chart-empty">No periods in range.</p>;

  // Round the axis top to something readable rather than the exact maximum.
  const axisTop = niceCeiling(max);

  return (
    <div className="chart-block">
      <div className="chart-head">
        {/* A legend is always present for two or more series. */}
        <ul className="legend" aria-labelledby={titleId}>
          {series.map((entry) => (
            <li key={entry.categoryId ?? entry.name}>
              <ColourDot slot={entry.colourSlot} />
              <span>{entry.name}</span>
            </li>
          ))}
        </ul>
        <ViewToggle view={view} onChange={setView} />
      </div>
      <span id={titleId} className="visually-hidden">
        Spending over time, by category
      </span>

      {view === 'chart' ? (
        <div className="trend" onPointerLeave={() => setTooltip(null)}>
          <div className="trend-axis" aria-hidden="true">
            <span>{formatMoneyCompact(axisTop, currency)}</span>
            <span>{formatMoneyCompact(axisTop / 2, currency)}</span>
            <span>{formatMoneyCompact(0, currency)}</span>
          </div>
          <div className="trend-plot">
            <div className="trend-grid" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            {buckets.map((bucket, columnIndex) => {
              const heightPercent = Math.max(0, (bucket.totalMinor / axisTop) * 100);
              const segments = series
                .map((entry) => {
                  const key = entry.categoryId ?? '';
                  const value =
                    entry.name === 'Other'
                      ? Object.entries(bucket.byCategory)
                          .filter(([id]) => !foldedKeys.has(id))
                          .reduce((sum, [, amount]) => sum + amount, 0)
                      : (bucket.byCategory[key] ?? 0);
                  return { entry, value };
                })
                .filter((segment) => segment.value > 0);

              return (
                <div
                  key={bucket.bucket}
                  className="trend-column"
                  tabIndex={0}
                  role="button"
                  aria-label={`${formatBucketLabel(bucket.bucket, bucketSize)}: ${formatMoney(bucket.totalMinor, currency)}`}
                  onPointerMove={(event) => {
                    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
                    setTooltip({
                      x: event.clientX - bounds.left,
                      y: event.clientY - bounds.top,
                      title: formatBucketLabel(bucket.bucket, bucketSize),
                      rows: [
                        { label: 'total', value: formatMoney(bucket.totalMinor, currency), slot: 0 },
                        ...segments
                          .slice()
                          .sort((a, b) => b.value - a.value)
                          .map((segment) => ({
                            label: segment.entry.name,
                            value: formatMoney(segment.value, currency),
                            slot: segment.entry.colourSlot,
                          })),
                      ],
                    });
                  }}
                >
                  <div className="trend-stack" style={{ height: `${heightPercent}%` }}>
                    {segments.map((segment) => (
                      <span
                        key={segment.entry.categoryId ?? segment.entry.name}
                        className="trend-segment"
                        style={{
                          flexGrow: segment.value,
                          background: colourFor(segment.entry.colourSlot),
                        }}
                      />
                    ))}
                  </div>
                  {columnIndex % tickStep === 0 && (
                    <span className="trend-tick">{formatBucketLabel(bucket.bucket, bucketSize)}</span>
                  )}
                </div>
              );
            })}
            <Tooltip state={tooltip} />
          </div>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Spending over time by category</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                {series.map((entry) => (
                  <th key={entry.categoryId ?? entry.name} scope="col" className="num">
                    {entry.name}
                  </th>
                ))}
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.bucket}>
                  <th scope="row">{formatBucketLabel(bucket.bucket, bucketSize)}</th>
                  {series.map((entry) => {
                    const key = entry.categoryId ?? '';
                    const value =
                      entry.name === 'Other'
                        ? Object.entries(bucket.byCategory)
                            .filter(([id]) => !foldedKeys.has(id))
                            .reduce((sum, [, amount]) => sum + amount, 0)
                        : (bucket.byCategory[key] ?? 0);
                    return (
                      <td key={entry.categoryId ?? entry.name} className="num">
                        {value === 0 ? '—' : formatMoneyPlain(value)}
                      </td>
                    );
                  })}
                  <td className="num">{formatMoneyPlain(bucket.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Round an axis maximum up to 1, 2 or 5 times a power of ten. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** A single headline number plus optional supporting detail. */
export function StatTile({
  label,
  value,
  detail,
  hero = false,
}: {
  label: string;
  value: string;
  detail?: string;
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'stat stat-hero' : 'stat'}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {detail && <p className="stat-detail">{detail}</p>}
    </div>
  );
}
