import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireRole } from './auth/guards';
import { useAuth } from './auth/store';
import { AppShell } from './layout/AppShell';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AgentsPage } from './pages/admin/AgentsPage';
import { ConfigPage } from './pages/admin/ConfigPage';
import { DncPage } from './pages/admin/DncPage';
import { OverviewPage } from './pages/admin/OverviewPage';
import { LeadsPage } from './pages/admin/LeadsPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { LoginPage } from './pages/LoginPage';
import { CallbacksPage } from './pages/CallbacksPage';
import { LeadTimelinePage } from './pages/LeadTimelinePage';
import { QueuePage } from './pages/QueuePage';
import { WorkspacePage } from './pages/WorkspacePage';

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
            <Route path="/leads/:id" element={<WorkspacePage />} />
            <Route path="/leads/:id/timeline" element={<LeadTimelinePage />} />
            <Route path="/callbacks" element={<CallbacksPage />} />
            <Route element={<RequireRole role="superadmin" />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/overview" replace />} />
                <Route path="overview" element={<OverviewPage />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="agents" element={<AgentsPage />} />
                <Route path="config" element={<ConfigPage />} />
                <Route path="dnc" element={<DncPage />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
