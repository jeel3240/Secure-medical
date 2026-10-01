import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PublicUser } from '../api/types';
import { useAuth } from '../auth/store';
import { useEscape } from '../components/useDismiss';

export function UserMenu({ user }: { user: PublicUser }) {
  const logout = useAuth((s) => s.logout);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEscape(open, close);
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const roleLabel = user.role === 'superadmin' ? 'Superadmin' : 'Agent';

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {user.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="user-menu__label">
          <span className="user-menu__name">{user.name}</span>{' '}
          <span className="user-menu__role">· {roleLabel}</span>
        </span>
      </button>

      {open ? (
        <div className="user-menu__panel" role="menu">
          <div className="user-menu__identity">
            <div>{user.name}</div>
            <div className="user-menu__email">{user.email}</div>
          </div>
          <Link className="user-menu__item" role="menuitem" to="/change-password" onClick={close}>
            Change password
          </Link>
          <button type="button" className="user-menu__item" role="menuitem" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
