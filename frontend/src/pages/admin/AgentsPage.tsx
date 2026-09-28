import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toApiError } from '../../api/client';
import type { PublicUser, Role } from '../../api/types';
import { listUsers, resetUserPassword, updateUser } from '../../api/users';
import { useAuth } from '../../auth/store';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { OneTimeSecret } from '../../components/OneTimeSecret';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu';
import { StatusIcon } from '../../components/StatusIcon';
import { AddAgentDrawer } from './AddAgentDrawer';
import { formatLastLogin } from '../../lib/format';

type Dialog =
  | { kind: 'add' }
  | { kind: 'reset'; user: PublicUser }
  | { kind: 'deactivate'; user: PublicUser }
  | { kind: 'role'; user: PublicUser; role: Role }
  | { kind: 'secret'; user: PublicUser; password: string };

/**
 * Admin > Agents, laid out like the other admin pages - Jeel, 2026-09-28: one
 * card, the grey header band, the email under the name as the phone sits under
 * a lead's, role and status as an icon and words, and each row's actions behind
 * one "⋯" menu instead of three text buttons.
 */
const COLUMNS = ['Agent', 'Role', 'Status', 'Last login', ''];

function ConfirmDialog({
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

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {COLUMNS.map((_, col) => (
            <td key={col}>
              <span className="skeleton" style={{ width: col === 4 ? 24 : `${50 + ((row + col) % 3) * 15}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function AgentsPage() {
  const me = useAuth((s) => s.user)!;
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setUsers(await listUsers());
    } catch (err) {
      setLoadError(toApiError(err).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const closeDialog = useCallback(() => setDialog(null), []);

  function replaceUser(updated: PublicUser) {
    setUsers((current) => current?.map((u) => (u.id === updated.id ? updated : u)) ?? current);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-subtitle">Accounts that can sign in to the call center.</p>
        </div>
        <Button onClick={() => setDialog({ kind: 'add' })}>Add agent</Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {flash ? <Banner tone="success">{flash}</Banner> : null}
        {loadError ? (
          <Banner tone="error">
            Could not load agents. {loadError}{' '}
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </Banner>
        ) : null}

        <section className="card queue-card">
          <div className="table-wrap">
            <table className="table queue__table">
              <thead>
                <tr>
                  {COLUMNS.map((column, index) => (
                    <th key={index}>{column ? column : <span className="visually-hidden">Actions</span>}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users === null && !loadError ? <SkeletonRows /> : null}
                {users?.map((user) => {
                  const isMe = user.id === me.id;
                  const actions: RowMenuItem[] = [
                    {
                      label: user.role === 'superadmin' ? 'Make agent' : 'Make superadmin',
                      onSelect: () =>
                        setDialog({ kind: 'role', user, role: user.role === 'superadmin' ? 'agent' : 'superadmin' }),
                    },
                    { label: 'Reset password', onSelect: () => setDialog({ kind: 'reset', user }) },
                    user.isActive
                      ? { label: 'Deactivate', danger: true, onSelect: () => setDialog({ kind: 'deactivate', user }) }
                      : {
                          label: 'Reactivate',
                          onSelect: async () => {
                            try {
                              replaceUser(await updateUser(user.id, { isActive: true }));
                              setFlash(`${user.name} can sign in again.`);
                            } catch (err) {
                              setLoadError(toApiError(err).message);
                            }
                          },
                        },
                  ];
                  return (
                    <tr key={user.id} className={user.isActive ? undefined : 'table__row--inactive'}>
                      <td>
                        <span className="queue__name agents__name">
                          {user.name}
                          {isMe ? <span className="agents__you">You</span> : null}
                        </span>
                        <span className="agents__email">{user.email}</span>
                      </td>
                      <td>
                        <span className="status">
                          <StatusIcon name={user.role === 'superadmin' ? 'shield' : 'person'} />
                          {user.role === 'superadmin' ? 'Superadmin' : 'Agent'}
                        </span>
                      </td>
                      <td>
                        {!user.isActive ? (
                          <span className="status status--muted">
                            <StatusIcon name="ban" />
                            Inactive
                          </span>
                        ) : user.mustChangePassword ? (
                          <span className="status status--warning">
                            <StatusIcon name="clock" />
                            Pending first sign-in
                          </span>
                        ) : (
                          <span className="status">
                            <StatusIcon name="check" />
                            Active
                          </span>
                        )}
                      </td>
                      <td className="leads__when">{formatLastLogin(user.lastLoginAt)}</td>
                      <td className="agents__actions">
                        {/* Your own row has no menu: changing your own role or
                            deactivating yourself would lock you out, and your
                            password is changed from your menu. */}
                        {isMe ? null : <RowMenu label={`Actions for ${user.name}`} items={actions} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {dialog?.kind === 'add' ? (
        <AddAgentDrawer
          onClose={closeDialog}
          onCreated={(user) => setUsers((current) => (current ? [...current, user] : [user]))}
        />
      ) : null}

      {dialog?.kind === 'reset' ? (
        <ConfirmDialog
          title={`Reset password for ${dialog.user.name}?`}
          confirmLabel="Reset password"
          onClose={closeDialog}
          onConfirm={async () => {
            const result = await resetUserPassword(dialog.user.id);
            replaceUser(result.user);
            setDialog({ kind: 'secret', user: result.user, password: result.temporaryPassword });
          }}
        >
          <p>
            Their current password stops working and they are signed out everywhere. You will get a temporary password
            to give them, and they must set a new one when they sign in.
          </p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === 'deactivate' ? (
        <ConfirmDialog
          title={`Deactivate ${dialog.user.name}?`}
          confirmLabel="Deactivate"
          danger
          onClose={closeDialog}
          onConfirm={async () => {
            replaceUser(await updateUser(dialog.user.id, { isActive: false }));
            setFlash(`${dialog.user.name} was deactivated and signed out.`);
            closeDialog();
          }}
        >
          <p>
            They are signed out immediately and cannot sign in until reactivated. Their calls, notes and history stay.
          </p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === 'role' ? (
        <ConfirmDialog
          title={
            dialog.role === 'superadmin' ? `Make ${dialog.user.name} a superadmin?` : `Make ${dialog.user.name} an agent?`
          }
          confirmLabel={dialog.role === 'superadmin' ? 'Make superadmin' : 'Make agent'}
          onClose={closeDialog}
          onConfirm={async () => {
            replaceUser(await updateUser(dialog.user.id, { role: dialog.role }));
            setFlash(`${dialog.user.name} is now ${dialog.role === 'superadmin' ? 'a superadmin' : 'an agent'}.`);
            closeDialog();
          }}
        >
          <p>
            {dialog.role === 'superadmin'
              ? 'They get full access, including Admin, every agent’s activity and account management.'
              : 'They lose access to Admin immediately.'}
          </p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === 'secret' ? (
        <Modal
          title={`New temporary password for ${dialog.user.name}`}
          footer={
            <Button onClick={closeDialog} autoFocus>
              Done
            </Button>
          }
        >
          <OneTimeSecret value={dialog.password} forName={dialog.user.name} />
        </Modal>
      ) : null}
    </>
  );
}
