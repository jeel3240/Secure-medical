import type { TwilioSettings } from '../twilio-settings';
import type { UserStore } from './users/types';

export interface AppDeps {
  users: UserStore;
  jwtSecret: string;
  /** Set the Secure flag on the session cookie. True in production (HTTPS). */
  secureCookies: boolean;
  /** Browser calling's settings, or null when calling is not set up - TWILIO.md. */
  twilio: TwilioSettings | null;
}
