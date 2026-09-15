import { useEffect, useRef, useState } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  formatIsoDateLong,
  isIsoDate,
  startOfMonth,
  todayIso,
  type DateRange,
} from '@bill/shared';

/**
 * Presets as rows, custom range behind a hairline in the footer. Nobody wants to
 * fight a calendar grid to say "last 30 days".
 */

export interface RangePreset {
  id: string;
  label: string;
  build: (today: string) => DateRange;
}

export const RANGE_PRESETS: RangePreset[] = [
  { id: 'this-month', label: 'This month', build: (today) => ({ from: startOfMonth(today), to: today }) },
  {
    id: 'last-month',
    label: 'Last month',
    build: (today) => {
      const lastMonth = addMonths(startOfMonth(today), -1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    },
  },
  { id: 'last-30', label: 'Last 30 days', build: (today) => ({ from: addDays(today, -29), to: today }) },
  { id: 'last-90', label: 'Last 3 months', build: (today) => ({ from: addDays(today, -89), to: today }) },
  { id: 'this-year', label: 'This year', build: (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: today }) },
  { id: 'last-365', label: 'Last 12 months', build: (today) => ({ from: addMonths(today, -12), to: today }) },
];

export function DateRangePicker({
  range,
  presetId,
  onChange,
}: {
  range: DateRange;
  presetId: string | null;
  onChange: (range: DateRange, presetId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const activeLabel =
    RANGE_PRESETS.find((preset) => preset.id === presetId)?.label ??
    `${formatIsoDateLong(range.from)} – ${formatIsoDateLong(range.to)}`;

  function applyCustom() {
    if (!isIsoDate(customFrom) || !isIsoDate(customTo)) {
      setError('Enter two valid dates.');
      return;
    }
    if (customFrom > customTo) {
      setError('The start date is after the end date.');
      return;
    }
    setError(null);
    onChange({ from: customFrom, to: customTo }, null);
    setOpen(false);
  }

  return (
    <div className="range-picker" ref={containerRef}>
      <button
        type="button"
        className="range-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="range-trigger-label">{activeLabel}</span>
        <span className="range-trigger-dates">
          {formatIsoDateLong(range.from)} – {formatIsoDateLong(range.to)}
        </span>
      </button>

      {open && (
        <div className="range-menu" role="dialog" aria-label="Choose a date range">
          <ul className="range-presets">
            {RANGE_PRESETS.map((preset) => {
              const selected = preset.id === presetId;
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = preset.build(todayIso());
                      setCustomFrom(next.from);
                      setCustomTo(next.to);
                      onChange(next, preset.id);
                      setOpen(false);
                    }}
                  >
                    <span className="range-check" aria-hidden="true">
                      {selected ? '✓' : ''}
                    </span>
                    {preset.label}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="range-custom">
            <p className="range-custom-title">Custom range</p>
            <div className="range-custom-fields">
              <label>
                <span>From</span>
                <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label>
                <span>To</span>
                <input type="date" value={customTo} min={customFrom} max={todayIso()} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </div>
            {error && <p className="range-error">{error}</p>}
            <button type="button" className="btn btn-primary btn-sm" onClick={applyCustom}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
