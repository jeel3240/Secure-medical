export const ROLES = ['superadmin', 'agent'] as const;
export type Role = (typeof ROLES)[number];

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
  };
}
