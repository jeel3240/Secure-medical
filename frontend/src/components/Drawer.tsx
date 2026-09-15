import { useId, type ReactNode } from 'react';
import { Button } from './Button';
import { useEscape } from './useDismiss';

interface DrawerProps {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose?: () => void;
}

export function Drawer({ title, children, footer, onClose }: DrawerProps) {
  const titleId = useId();
  useEscape(Boolean(onClose), () => onClose?.());

  return (
    <div
      className="overlay overlay--right"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="drawer__header">
          <h2 id={titleId} className="drawer__title">
            {title}
          </h2>
          {onClose ? (
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              Close
            </Button>
          ) : null}
        </div>
        <div className="drawer__body">{children}</div>
        <div className="drawer__footer">{footer}</div>
      </aside>
    </div>
  );
}
