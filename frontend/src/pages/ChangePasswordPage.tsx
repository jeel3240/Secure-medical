import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { changePassword } from '../api/auth';
import { toApiError } from '../api/client';
import { useAuth } from '../auth/store';
import { Banner } from '../components/Banner';
import { AuthLayout } from '../components/AuthLayout';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

// Mirrors MIN_PASSWORD_LENGTH in backend/src/api/auth/password.ts. The server
// is the authority; this is only so the hint is right before submitting.
const MIN_LENGTH = 10;

function CheckHint({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={`check-hint${ok ? ' check-hint--ok' : ''}`}>
      <span className="check-hint__dot" aria-hidden="true" />
      {children}
      <span className="visually-hidden">{ok ? '(met)' : '(not met)'}</span>
    </span>
  );
}

export function ChangePasswordPage() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const forced = Boolean(user?.mustChangePassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const longEnough = newPassword.length >= MIN_LENGTH;
  const matches = newPassword.length > 0 && newPassword === confirm;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    if (!currentPassword) {
      setError(forced ? 'Enter the temporary password you signed in with.' : 'Enter your current password.');
      return;
    }
    if (!longEnough) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (!matches) {
      setError('The two new passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await changePassword(currentPassword, newPassword);
      setUser(updated);
      navigate('/', { replace: true });
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="auth-card__title">{forced ? 'Set a new password' : 'Change password'}</h1>
      <p className="auth-card__subtitle">
        {forced
          ? `Welcome, ${user?.name}. Replace your temporary password before continuing.`
          : 'Other devices signed in to your account will be signed out.'}
      </p>

      <form className="auth-card__form" onSubmit={handleSubmit} noValidate>
        {error ? <Banner tone="error">{error}</Banner> : null}

        <TextField
          label={forced ? 'Temporary password' : 'Current password'}
          type="password"
          autoComplete="current-password"
          placeholder={forced ? 'The password your admin gave you' : 'Enter your current password'}
          autoFocus
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 10 characters"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          hint={<CheckHint ok={longEnough}>{`At least ${MIN_LENGTH} characters`}</CheckHint>}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Type the new password again"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          hint={<CheckHint ok={matches}>Matches</CheckHint>}
        />
        <Button type="submit" size="lg" block loading={submitting}>
          {forced ? 'Set password and continue' : 'Change password'}
        </Button>
      </form>

      <div className="auth-card__footer">
        {forced ? (
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        ) : (
          <Link to="/">Cancel</Link>
        )}
      </div>
    </AuthLayout>
  );
}
