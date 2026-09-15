import type { CookieOptions } from 'express';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE = 'sm_session';

/** Roughly one shift. No refresh tokens: agents sign in once a day. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionClaims {
  userId: number;
  sessionVersion: number;
}

export function signSession(userId: number, sessionVersion: number, secret: string): string {
  return jwt.sign({ sv: sessionVersion }, secret, {
    subject: String(userId),
    expiresIn: SESSION_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

/** Returns null for anything that is not a valid, unexpired token of ours. */
export function verifySession(token: string, secret: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string') return null;
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || typeof payload.sv !== 'number') return null;
    return { userId, sessionVersion: payload.sv };
  } catch {
    return null;
  }
}

/**
 * httpOnly: page scripts cannot read the token, so an injected script cannot
 * steal it. SameSite=Strict: the browser never attaches it to a request started
 * from another site, which is what stops cross-site request forgery here - the
 * app and API share one origin, so nothing legitimate needs cross-site cookies.
 * Secure is on in production (HTTPS via Caddy) and off locally (plain HTTP).
 */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

export function clearSessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure, path: '/' };
}
