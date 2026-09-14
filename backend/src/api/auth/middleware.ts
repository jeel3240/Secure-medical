import type { Request, RequestHandler, Response } from 'express';
import type { AppDeps } from '../deps';
import { asyncHandler, HttpError } from '../http';
import type { Role, UserRow } from '../users/types';
import { clearSessionCookieOptions, SESSION_COOKIE, verifySession } from './session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth. Loaded fresh from the database on every request. */
      user?: UserRow;
    }
  }
}

/**
 * Returns the signed-in user, or null when there is no valid session: no
 * cookie, a bad or expired token, a deleted or inactive user, or a session
 * ended since the token was issued.
 *
 * The user row is re-read on every request - one indexed lookup, trivial at
 * ~10 agents - so deactivation and role changes apply immediately rather than
 * when the token expires.
 */
export async function resolveSessionUser(deps: AppDeps, req: Request, res: Response): Promise<UserRow | null> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const claims = typeof token === 'string' ? verifySession(token, deps.jwtSecret) : null;
  const user = claims ? await deps.users.findById(claims.userId) : null;

  if (!claims || !user || !user.isActive || user.sessionVersion !== claims.sessionVersion) {
    // A dead cookie is removed so the browser stops sending it.
    if (token !== undefined) {
      res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(deps.secureCookies));
    }
    return null;
  }
  return user;
}

export function requireAuth(deps: AppDeps): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const user = await resolveSessionUser(deps, req, res);
    if (!user) {
      throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
    }
    req.user = user;
    next();
  });
}

/**
 * Blocks everything for a user still on a temporary password. Routes that must
 * stay reachable in that state - who am I, change password, sign out - are
 * mounted without it.
 */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (req.user?.mustChangePassword) {
    next(new HttpError(403, 'password_change_required', 'Set a new password before continuing.'));
    return;
  }
  next();
};

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (req.user?.role !== role) {
      next(new HttpError(403, 'forbidden', 'You do not have access to this.'));
      return;
    }
    next();
  };
}
