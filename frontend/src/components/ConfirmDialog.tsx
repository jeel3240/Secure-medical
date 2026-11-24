import { useState, type ReactNode } from 'react';
import { toApiError } from '../api/client';
import { Banner } from './Banner';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * A yes-or-no before an action that changes something for others: the action
 * runs on the confirm button, and a failure is shown in the dialog, which
 * stays open. Admin > Agents' deactivate and role changes, and Seri's switch
 * on Configuration - one copy since 2026-11-24.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={() => void confirm()} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? <Banner tone="error">{error}</Banner> : null}
      {children}
    </Modal>
  );
}
