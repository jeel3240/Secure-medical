export type Role = 'superadmin' | 'agent';

/** Why "Taking calls" is as it is now - `missed_transfer`: the server turned it off (T15c). */
export type TakingCallsWhy = 'by_hand' | 'sign_in' | 'sign_out' | 'missed_transfer';

/** Mirrors PublicUser in backend/src/api/users/types.ts. */
export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** The "Taking calls" switch - T10, AUTO-CALLS.md "Who is free". */
  takingCalls: boolean;
  /** Why it is as it is now; null for a switch never set. */
  takingCallsWhy: TakingCallsWhy | null;
}
