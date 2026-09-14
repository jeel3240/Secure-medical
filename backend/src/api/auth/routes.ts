import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { AppDeps } from '../deps';
import { asyncHandler, HttpError } from '../http';
import { normalizeEmail } from '../users/rules';
import { toPublicUser } from '../users/types';
import { requireAuth, resolveSessionUser } from './middleware';
import { burnPasswordCheck, hashPassword, validateNewPassword, verifyPassword } from './password';
import {
  clearSessionCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
} from './session';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

function invalidCredentials(): HttpError {
  // Same code and message for unknown email, wrong password and inactive
  // account, so the response never confirms that an email is registered.
  return new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
}

export function authRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);

  // Per IP, counting only failed attempts, so an agent who signs in correctly is
  // never slowed down. Behind Caddy the IP comes from X-Forwarded-For, which is
  // why the app sets trust proxy to one hop.
  const loginLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_MAX_FAILURES,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: 'too_many_attempts',
        message: 'Too many sign-in attempts. Try again in a few minutes.',
      });
    },
  });

  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      const { email, password } = (req.body ?? {}) as Record<string, unknown>;
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        throw new HttpError(400, 'invalid_request', 'Email and password are required.');
      }

      const user = await deps.users.findByEmail(normalizeEmail(email));
      if (!user || !user.isActive) {
        await burnPasswordCheck(password);
        throw invalidCredentials();
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        throw invalidCredentials();
      }

      await deps.users.recordLogin(user.id);
      res.cookie(
        SESSION_COOKIE,
        signSession(user.id, user.sessionVersion, deps.jwtSecret),
        sessionCookieOptions(deps.secureCookies)
      );
      res.json({ user: toPublicUser({ ...user, lastLoginAt: new Date() }) });
    })
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      // Ending the session server-side, not just deleting the cookie, means a
      // copied token stops working too. Signing out with no valid session is
      // still a success - the outcome the caller wants is already true.
      const token: unknown = req.cookies?.[SESSION_COOKIE];
      const claims = typeof token === 'string' ? verifySession(token, deps.jwtSecret) : null;
      if (claims) {
        const user = await deps.users.findById(claims.userId);
        if (user && user.sessionVersion === claims.sessionVersion) {
          await deps.users.update(user.id, { bumpSession: true });
        }
      }
      res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(deps.secureCookies));
      res.status(204).end();
    })
  );

  // Answers "nobody" with 200 rather than 401. Every page load asks this before
  // anyone has signed in, and a 401 there is the expected case, not an error -
  // returning one would put a red network error in the console on every visit
  // to the sign-in page.
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const user = await resolveSessionUser(deps, req, res);
      res.json({ user: user ? toPublicUser(user) : null });
    })
  );

  router.post(
    '/change-password',
    auth,
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const { currentPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;

      if (typeof currentPassword !== 'string' || !currentPassword) {
        throw new HttpError(400, 'invalid_request', 'Enter your current password.');
      }
      const problem = validateNewPassword(newPassword);
      if (problem) {
        throw new HttpError(400, 'weak_password', problem);
      }
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new HttpError(400, 'wrong_current_password', 'Current password is incorrect.');
      }
      if (newPassword === currentPassword) {
        throw new HttpError(400, 'password_unchanged', 'New password must be different from the current one.');
      }

      // Bumping the session signs the user out everywhere else. This request
      // gets a fresh cookie so the person changing the password stays in.
      const updated = await deps.users.update(user.id, {
        passwordHash: await hashPassword(newPassword as string),
        mustChangePassword: false,
        bumpSession: true,
      });
      if (!updated) {
        throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
      }

      res.cookie(
        SESSION_COOKIE,
        signSession(updated.id, updated.sessionVersion, deps.jwtSecret),
        sessionCookieOptions(deps.secureCookies)
      );
      res.json({ user: toPublicUser(updated) });
    })
  );

  return router;
}
