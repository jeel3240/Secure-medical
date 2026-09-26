import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireRole } from './auth/guards';
import { useAuth } from './auth/store';
import { AppShell } from './layout/AppShell';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AgentsPage } from './pages/admin/AgentsPage';
import { LeadsPage } from './pages/admin/LeadsPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { LoginPage } from './pages/LoginPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { QueuePage } from './pages/QueuePage';

export function App() {
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<RequireAuth allowPendingPasswordChange />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/queue" replace />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route
              path="/callbacks"
              element={
                <PlaceholderPage
                  title="My callbacks"
                  description="Callbacks you schedule from the agent workspace will appear here."
                />
              }
            />
            <Route element={<RequireRole role="superadmin" />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/leads" replace />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="agents" element={<AgentsPage />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
