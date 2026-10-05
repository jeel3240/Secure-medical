import type { ActivityEntry } from '../core/activity';
import type { TwilioSettings } from '../twilio-settings';
import type { UserStore } from './users/types';

export interface AppDeps {
  users: UserStore;
  jwtSecret: string;
  /** Set the Secure flag on the session cookie. True in production (HTTPS). */
  secureCookies: boolean;
  /** Browser calling's settings, or null when calling is not set up - TWILIO.md. */
  twilio: TwilioSettings | null;
  /**
   * Writes the activity log - AUDIT.md. Sign-ins and account changes go
   * through here; the writes on a lead record themselves in their own SQL.
   */
  activity: { record: (entry: ActivityEntry) => Promise<void> };
}
