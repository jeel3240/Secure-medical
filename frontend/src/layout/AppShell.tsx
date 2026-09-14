import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/store';
import { BrandMark } from '../components/BrandMark';
import { UserMenu } from './UserMenu';

export function AppShell() {
  const user = useAuth((s) => s.user)!;

  return (
    <div className="shell">
      <header className="appbar">
        <div className="appbar__inner">
          <NavLink to="/" className="appbar__brand">
            <BrandMark />
            SM Call Center
          </NavLink>

          <nav className="appbar__nav" aria-label="Primary">
            <NavLink to="/queue" className="appbar__link">
              Queue
            </NavLink>
            <NavLink to="/callbacks" className="appbar__link">
              My Callbacks
            </NavLink>
            {user.role === 'superadmin' ? (
              <NavLink to="/admin" className="appbar__link">
                Admin
              </NavLink>
            ) : null}
          </nav>

          <div className="appbar__right">
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <main className="shell__content">
        <Outlet />
      </main>
    </div>
  );
}
