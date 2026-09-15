import { create } from 'zustand';
import * as authApi from '../api/auth';
import { onSessionEvent, toApiError } from '../api/client';
import type { PublicUser } from '../api/types';

type Status = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthState {
  status: Status;
  user: PublicUser | null;
  /** One-off message for the sign-in page, e.g. why the user was signed out. */
  notice: string | null;
  bootstrapError: string | null;

  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
  setUser: (user: PublicUser) => void;
  clearNotice: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  notice: null,
  bootstrapError: null,

  async bootstrap() {
    set({ status: 'loading', bootstrapError: null });
    try {
      const user = await authApi.fetchMe();
      set(user ? { status: 'authenticated', user } : { status: 'anonymous', user: null });
    } catch (err) {
      set({ status: 'error', bootstrapError: toApiError(err).message });
    }
  },

  async login(email, password) {
    const user = await authApi.login(email, password);
    set({ status: 'authenticated', user, notice: null });
    return user;
  },

  async logout() {
    try {
      await authApi.logout();
    } finally {
      // Signed out locally even if the request failed; the cookie is httpOnly,
      // so the server is the only thing that can clear it, and the next
      // request will be rejected anyway if the session is still alive.
      set({ status: 'anonymous', user: null, notice: null });
    }
  },

  setUser(user) {
    set({ status: 'authenticated', user });
  },

  clearNotice() {
    if (get().notice) set({ notice: null });
  },
}));

onSessionEvent((event) => {
  const { user } = useAuth.getState();
  if (event === 'ended' && user) {
    useAuth.setState({
      status: 'anonymous',
      user: null,
      notice: 'Your session ended. Sign in again to continue.',
    });
  }
  if (event === 'password_change_required' && user && !user.mustChangePassword) {
    useAuth.setState({ user: { ...user, mustChangePassword: true } });
  }
});
