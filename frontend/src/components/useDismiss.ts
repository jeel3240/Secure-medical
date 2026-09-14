import { useEffect } from 'react';

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
