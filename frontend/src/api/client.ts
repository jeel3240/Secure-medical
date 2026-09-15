import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

export interface ApiError {
  /** HTTP status, or null when the server could not be reached at all. */
  status: number | null;
  /** Stable code from the API's `error` field, e.g. `invalid_credentials`. */
  code: string;
  /** Human-readable message, safe to show as-is. */
  message: string;
}

export function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    if (err.response) {
      const body = err.response.data as { error?: string; message?: string } | undefined;
      return {
        status: err.response.status,
        code: body?.error ?? 'http_error',
        message: body?.message ?? `Request failed (${err.response.status}).`,
      };
    }
    return {
      status: null,
      code: 'network_error',
      message: 'Cannot reach the server. Check your connection and try again.',
    };
  }
  return { status: null, code: 'unknown', message: 'Something went wrong.' };
}

type SessionEvent = 'ended' | 'password_change_required';
let sessionListener: ((event: SessionEvent) => void) | null = null;

/** The auth store registers here to hear about sessions that end mid-use. */
export function onSessionEvent(listener: (event: SessionEvent) => void): void {
  sessionListener = listener;
}

// A 401 on any ordinary request means the session is gone - expired,
// deactivated, password reset by an admin, or signed out elsewhere. Sign-in
// handles its own 401 (wrong password), so it is left out.
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response) {
      const url = error.config?.url ?? '';
      const code = (error.response.data as { error?: string } | undefined)?.error;
      if (error.response.status === 401 && url !== '/auth/login') {
        sessionListener?.('ended');
      }
      if (error.response.status === 403 && code === 'password_change_required') {
        sessionListener?.('password_change_required');
      }
    }
    return Promise.reject(error);
  }
);
