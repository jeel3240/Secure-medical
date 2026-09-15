import { useId, type ReactNode } from 'react';
import { useEscape } from './useDismiss';

interface ModalProps {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  /** Omit to make the dialog impossible to dismiss by Escape or backdrop click. */
  onClose?: () => void;
}

export function Modal({ title, children, footer, onClose }: ModalProps) {
  const titleId = useId();
  useEscape(Boolean(onClose), () => onClose?.());

  return (
    <div
      className="overlay overlay--center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
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
