import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime, toLocalInput } from '../lib/format';
import { Button } from './Button';
import { useEscape } from './useDismiss';

/**
 * A date and time field in the app's own style - Jeel, 2026-09-29.
 *
 * Replaces `<input type="datetime-local">`, whose calendar is drawn by the
 * browser: its own blue, fonts and borders, and almost none of it can be
 * styled. This is a button that opens a small calendar and a time menu.
 *
 * The value is the same string that input used - local time, no zone,
 * `2026-09-29T15:30`, or '' for none - so callers did not change.
 *
 * Days before today cannot be picked, nor times already past today: a callback
 * is always in the future. The panel is fixed-position, like RowMenu's, so a
 * table or card with hidden overflow cannot clip it, and it closes on Escape,
 * a click outside, scroll or resize.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const STEP_MINUTES = 15;
const DEFAULT_TIME = '10:00';
const PANEL_WIDTH = 288;
const PANEL_HEIGHT = 380;

const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The 6 weeks shown for a month: Sunday first, spilling into the months either side. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Every 15 minutes of a day, as "HH:mm". */
export function timeSlots(): string[] {
  return Array.from({ length: (24 * 60) / STEP_MINUTES }, (_, i) => {
    const minutes = i * STEP_MINUTES;
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  });
}

function slotLabel(slot: string): string {
  const [h, m] = slot.split(':').map(Number);
  return timeFormat.format(new Date(2000, 0, 1, h, m));
}

export function DateTimeField({
  value,
  onChange,
  label,
  defaultOpen = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Read by screen readers, and shown when nothing is picked. */
  label: string;
  defaultOpen?: boolean;
}) {
  const now = new Date();
  const chosen = value ? new Date(value) : null;
  const [view, setView] = useState(() => {
    const d = chosen ?? now;
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = place !== null;
  const close = useCallback(() => setPlace(null), []);

  const show = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom > PANEL_HEIGHT + 8;
    setPlace({
      top: below ? rect.bottom + 6 : Math.max(8, rect.top - PANEL_HEIGHT - 6),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8)),
    });
  }, []);

  useEffect(() => {
    if (defaultOpen) show();
  }, [defaultOpen, show]);

  useEscape(open, close);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    document.addEventListener('mousedown', outside);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  const today = dayKey(now);
  const pickedDay = chosen ? dayKey(chosen) : null;
  const pickedTime = value ? value.slice(11, 16) : '';

  const setDay = (day: Date) => {
    const time = pickedTime || DEFAULT_TIME;
    const [h, m] = time.split(':').map(Number);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
    // Today at a time already gone: move to the next open slot.
    if (at <= now) {
      const next = new Date(now);
      next.setMinutes(Math.ceil((now.getMinutes() + 1) / STEP_MINUTES) * STEP_MINUTES, 0, 0);
      onChange(toLocalInput(next));
      return;
    }
    onChange(toLocalInput(at));
  };

  const setTime = (slot: string) => {
    const day = chosen ?? now;
    onChange(`${dayKey(day)}T${slot}`);
  };

  const moveMonth = (delta: number) =>
    setView(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const thisMonth = view.year === now.getFullYear() && view.month === now.getMonth();
  const slots = timeSlots().filter((slot) => pickedDay !== today || new Date(`${today}T${slot}`) > now);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`dt-field${chosen ? '' : ' dt-field--empty'}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        {chosen ? formatDateTime(chosen) : label}
      </button>

      {open && (
        <div ref={panel} className="dt-panel" role="dialog" aria-label={label} style={{ top: place.top, left: place.left }}>
          <div className="dt-panel__head">
            <button type="button" className="dt-panel__nav" aria-label="Previous month" disabled={thisMonth} onClick={() => moveMonth(-1)}>
              ‹
            </button>
            <span className="dt-panel__month">{monthFormat.format(new Date(view.year, view.month, 1))}</span>
            <button type="button" className="dt-panel__nav" aria-label="Next month" onClick={() => moveMonth(1)}>
              ›
            </button>
          </div>

          <div className="dt-panel__grid" role="grid">
            {WEEKDAYS.map((d) => (
              <span key={d} className="dt-panel__weekday">
                {d}
              </span>
            ))}
            {monthGrid(view.year, view.month).map((day) => {
              const key = dayKey(day);
              const past = key < today;
              const other = day.getMonth() !== view.month;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={past}
                  aria-pressed={key === pickedDay}
                  className={[
                    'dt-panel__day',
                    other && 'dt-panel__day--other',
                    key === today && 'dt-panel__day--today',
                    key === pickedDay && 'dt-panel__day--on',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setDay(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="dt-panel__foot">
            <select
              className="select-input dt-panel__time"
              aria-label="Time"
              value={slots.includes(pickedTime) ? pickedTime : ''}
              disabled={!chosen}
              onChange={(e) => setTime(e.target.value)}
            >
              {!slots.includes(pickedTime) && <option value="">{chosen ? slotLabel(pickedTime) : 'Pick a day first'}</option>}
              {slots.map((slot) => (
                <option key={slot} value={slot}>
                  {slotLabel(slot)}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!chosen} onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
