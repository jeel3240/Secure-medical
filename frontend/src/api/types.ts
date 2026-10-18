export type Role = 'superadmin' | 'agent';

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
}
