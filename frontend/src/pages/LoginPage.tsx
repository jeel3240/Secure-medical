import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toApiError } from '../api/client';
import { useAuth } from '../auth/store';
import { Banner } from '../components/Banner';
import { AuthLayout } from '../components/AuthLayout';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { TextField } from '../components/TextField';

export function LoginPage() {
  const { status, user, notice, login, clearNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // The notice explains a sign-out that already happened; drop it once the
  // user starts a new attempt so it cannot be mistaken for a fresh error.
  useEffect(() => () => clearNotice(), [clearNotice]);

  if (status === 'loading') {
    return (
      <div className="full-page-status">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (user) {
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    clearNotice();
    setError(null);

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      const apiError = toApiError(err);
      setError(apiError.message);
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="auth-card__title">Sign in</h1>
      <p className="auth-card__subtitle">Use the email and password your admin gave you.</p>

      <form className="auth-card__form" onSubmit={handleSubmit} noValidate>
        {notice && !error ? <Banner tone="info">{notice}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}

        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          placeholder="name@company.com"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" size="lg" block loading={submitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
