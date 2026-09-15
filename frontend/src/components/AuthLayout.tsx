import type { ReactNode } from 'react';

/**
 * Frame for the pages a user sees before they are inside the app: sign-in and
 * setting a password. A soft blue-grey ground keeps the white card in focus
 * without the glare of a plain white page.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-page__glow auth-page__glow--teal" aria-hidden="true" />
      <div className="auth-page__glow auth-page__glow--blue" aria-hidden="true" />

      <div className="auth-page__inner">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand__logo" aria-hidden="true">
              SM
            </span>
            <span>
              <span className="auth-brand__name">SM Call Center</span>
              <span className="auth-brand__tag">Secure Medical</span>
            </span>
          </div>
          {children}
        </div>

        <p className="auth-page__note">Internal tool. Accounts are created by your admin.</p>
      </div>
    </main>
  );
}
