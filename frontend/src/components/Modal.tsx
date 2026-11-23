import { useId, useRef, type ReactNode } from 'react';
import { useDialogFocus, useEscape } from './useDismiss';

interface ModalProps {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  /** Omit to make the dialog impossible to dismiss by Escape or backdrop click. */
  onClose?: () => void;
}

export function Modal({ title, children, footer, onClose }: ModalProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEscape(Boolean(onClose), () => onClose?.());
  useDialogFocus(box);

  return (
    <div
      className="overlay overlay--center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
        </div>
        <div className="modal__body">{children}</div>
        <div className="modal__footer">{footer}</div>
      </div>
    </div>
  );
}
