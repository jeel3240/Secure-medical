import { useEffect, type RefObject } from 'react';

/** Calls onDismiss when Escape is pressed, while `active` is true. */
export function useEscape(active: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onDismiss]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus for a dialog (review Q8, 2026-11-23): moved into it when it
 * opens - to a control that asked for it (`autoFocus`), else its first field,
 * else its first control, else the dialog itself - kept inside it while Tab
 * goes round, and given back
 * to whatever had it before when the dialog closes. Until then focus stayed on
 * the page behind the overlay, so a keyboard user typed into nothing.
 */
export function useDialogFocus(dialog: RefObject<HTMLElement>): void {
  useEffect(() => {
    const box = dialog.current;
    if (!box) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));

    if (!box.contains(document.activeElement)) {
      const field = controls().find((el) => el.matches('input, textarea, select'));
      (field ?? controls()[0] ?? box).focus();
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const all = controls();
      if (all.length === 0) {
        event.preventDefault();
        return;
      }
      const first = all[0];
      const last = all[all.length - 1];
      if (event.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, [dialog]);
}
