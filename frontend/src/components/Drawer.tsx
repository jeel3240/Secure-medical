import { useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { useDialogFocus, useEscape } from './useDismiss';

interface DrawerProps {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose?: () => void;
}

export function Drawer({ title, children, footer, onClose }: DrawerProps) {
  const titleId = useId();
  const box = useRef<HTMLElement>(null);
  useEscape(Boolean(onClose), () => onClose?.());
  useDialogFocus(box);

  return (
    <div
      className="overlay overlay--right"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <aside ref={box} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
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
