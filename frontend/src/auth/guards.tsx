import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../api/types';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { useAuth } from './store';

function FullPageStatus({ children }: { children: ReactNode }) {
  return <div className="full-page-status">{children}</div>;
}

/**
 * Renders children only for a signed-in user. Anyone still on a temporary
 * password is sent to set a new one first, unless this guard wraps that page.
 */
export function RequireAuth({ allowPendingPasswordChange = false }: { allowPendingPasswordChange?: boolean }) {
  const { status, user, bootstrapError, bootstrap } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <FullPageStatus>
        <Spinner label="Loading" />
      </FullPageStatus>
    );
  }
  if (status === 'error') {
    return (
      <FullPageStatus>
        <p className="full-page-status__message">{bootstrapError}</p>
        <Button variant="secondary" onClick={() => void bootstrap()}>
          Try again
        </Button>
      </FullPageStatus>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (user.mustChangePassword && !allowPendingPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

export function RequireRole({ role }: { role: Role }) {
  const user = useAuth((s) => s.user);
  if (user?.role !== role) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
