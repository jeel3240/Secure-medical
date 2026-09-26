import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toApiError } from '../../api/client';
import type { PublicUser, Role } from '../../api/types';
import { listUsers, resetUserPassword, updateUser } from '../../api/users';
import { useAuth } from '../../auth/store';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { OneTimeSecret } from '../../components/OneTimeSecret';
import { AddAgentDrawer } from './AddAgentDrawer';
import { formatLastLogin } from '../../lib/format';

type Dialog =
  | { kind: 'add' }
  | { kind: 'reset'; user: PublicUser }
  | { kind: 'deactivate'; user: PublicUser }
  | { kind: 'role'; user: PublicUser; role: Role }
  | { kind: 'secret'; user: PublicUser; password: string };

const COLUMNS = ['Name', 'Email', 'Role', 'Status', 'Last login', ''];

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
              <span className="skeleton" style={{ width: col === 5 ? 80 : `${50 + ((row + col) % 3) * 15}%` }} />
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

        <section className="panel">
          <div className="table-wrap">
            <table className="table">
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
                  return (
                    <tr key={user.id} className={user.isActive ? undefined : 'table__row--inactive'}>
                      <td>
                        <span className="table__name">
                          {user.name}
                          {isMe ? <Badge tone="muted">You</Badge> : null}
                        </span>
                      </td>
                      <td>{user.email}</td>
                      <td>
                        {user.role === 'superadmin' ? <Badge tone="navy">Superadmin</Badge> : <Badge>Agent</Badge>}
                      </td>
                      <td>
                        {!user.isActive ? (
                          <Badge tone="muted" dot>
                            Inactive
                          </Badge>
                        ) : user.mustChangePassword ? (
                          <Badge tone="warning" dot>
                            Pending first sign-in
                          </Badge>
                        ) : (
                          <Badge tone="success" dot>
                            Active
                          </Badge>
                        )}
                      </td>
                      <td className="tabular">{formatLastLogin(user.lastLoginAt)}</td>
                      <td>
                        {isMe ? (
                          <div className="table__actions">
                            <span className="field__hint">Manage your password from your menu</span>
                          </div>
                        ) : (
                          <div className="table__actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDialog({
                                  kind: 'role',
                                  user,
                                  role: user.role === 'superadmin' ? 'agent' : 'superadmin',
                                })
                              }
                            >
                              {user.role === 'superadmin' ? 'Make agent' : 'Make superadmin'}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'reset', user })}>
                              Reset password
                            </Button>
                            {user.isActive ? (
                              <Button
                                key="deactivate"
                                variant="danger-ghost"
                                size="sm"
                                onClick={() => setDialog({ kind: 'deactivate', user })}
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                key="reactivate"
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    replaceUser(await updateUser(user.id, { isActive: true }));
                                    setFlash(`${user.name} can sign in again.`);
                                  } catch (err) {
                                    setLoadError(toApiError(err).message);
                                  }
                                }}
                              >
                                Reactivate
                              </Button>
                            )}
                          </div>
                        )}
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
