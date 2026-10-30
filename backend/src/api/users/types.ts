export const ROLES = ['superadmin', 'agent'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Why the "Taking calls" switch is as it is now - T10, and `missed_transfer`
 * since T15c: the server turned it off after the person let a transfer ring
 * out (AUTO-CALLS.md, "Who is free").
 */
export const TAKING_CALLS_WHY = ['by_hand', 'sign_in', 'sign_out', 'missed_transfer'] as const;
export type TakingCallsWhy = (typeof TAKING_CALLS_WHY)[number];

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  sessionVersion: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  /** The "Taking calls" switch - T10, AUTO-CALLS.md "Who is free". */
  takingCalls: boolean;
  /** Why it is as it is now; null for a switch never set. */
  takingCallsWhy: TakingCallsWhy | null;
}

/** What the API ever returns about a user. Never includes the hash or session version. */
export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  takingCalls: boolean;
  takingCallsWhy: TakingCallsWhy | null;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  mustChangePassword: boolean;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  isActive?: boolean;
  passwordHash?: string;
  mustChangePassword?: boolean;
  /** Ends every existing session for the user. */
  bumpSession?: boolean;
  /**
   * Sets "Taking calls", and why it is so. The time it changed is kept only
   * when it does; the reason is written every time.
   */
  takingCalls?: { on: boolean; why: TakingCallsWhy };
}

/**
 * Storage for users. The Postgres implementation lives in db/users.ts; tests use
 * an in-memory one, so the HTTP layer can be exercised without a database.
 */
export interface UserStore {
  findById(id: number): Promise<UserRow | null>;
  /** Expects an already-normalised (trimmed, lowercased) email. */
  findByEmail(email: string): Promise<UserRow | null>;
  list(): Promise<UserRow[]>;
  /** Throws EmailTakenError when the email already exists. */
  create(input: CreateUserInput): Promise<UserRow>;
  update(id: number, patch: UpdateUserInput): Promise<UserRow | null>;
  recordLogin(id: number): Promise<void>;
}

export class EmailTakenError extends Error {
  constructor() {
    super('A user with that email already exists.');
  }
}

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    takingCalls: user.takingCalls,
    takingCallsWhy: user.takingCallsWhy,
  };
}
