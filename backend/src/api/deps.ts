import type { UserStore } from './users/types';

export interface AppDeps {
  users: UserStore;
  jwtSecret: string;
  /** Set the Secure flag on the session cookie. True in production (HTTPS). */
  secureCookies: boolean;
}
