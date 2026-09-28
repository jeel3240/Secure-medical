import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscape } from './useDismiss';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  /** Red, for the one action that takes something away - Deactivate. */
  danger?: boolean;
}

/**
 * A "⋯" button that opens a row's actions - Admin > Agents, Jeel 2026-09-28.
 * Three text buttons on every row ("Make superadmin", "Reset password",
 * "Deactivate") were most of what made that table look busy.
 *
 * The panel is `position: fixed`, placed from the button's position when it
 * opens. Table rows sit inside `.table-wrap`, which scrolls sideways, and
 * anything absolutely positioned in there is cut off at its edge - the last
 * row's menu would be clipped. It closes on Escape, an outside click, a scroll
 * or a resize, since a fixed panel would otherwise float away from its row.
 *
 * Looks like the app bar's user menu, whose panel and item styles it reuses.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPlace(null), []);
  const open = place !== null;

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

  const toggle = () => {
    if (open) return close();
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPlace({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="row-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {place && (
        <div ref={panel} className="user-menu__panel row-menu__panel" role="menu" style={place}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`user-menu__item${item.danger ? ' row-menu__item--danger' : ''}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
