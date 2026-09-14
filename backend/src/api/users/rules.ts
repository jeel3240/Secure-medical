import { HttpError } from '../http';
import { ROLES, Role } from './types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

/** Emails are stored lowercased so sign-in is case-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  }
  const email = normalizeEmail(value);
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  }
  return email;
}

function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, 'invalid_name', `Name is required and must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function parseRole(value: unknown): Role {
  if (typeof value !== 'string' || !(ROLES as readonly string[]).includes(value)) {
    throw new HttpError(400, 'invalid_role', `Role must be one of: ${ROLES.join(', ')}.`);
  }
  return value as Role;
}

export function parseCreateUser(body: unknown): { email: string; name: string; role: Role } {
  const input = (body ?? {}) as Record<string, unknown>;
  return { email: parseEmail(input.email), name: parseName(input.name), role: parseRole(input.role) };
}

export function parseUpdateUser(body: unknown): { name?: string; role?: Role; isActive?: boolean } {
  const input = (body ?? {}) as Record<string, unknown>;
  const patch: { name?: string; role?: Role; isActive?: boolean } = {};

  if (input.name !== undefined) patch.name = parseName(input.name);
  if (input.role !== undefined) patch.role = parseRole(input.role);
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') {
      throw new HttpError(400, 'invalid_is_active', 'isActive must be true or false.');
    }
    patch.isActive = input.isActive;
  }

  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, 'empty_update', 'Nothing to update. Send name, role or isActive.');
  }
  return patch;
}

/**
 * A superadmin may not deactivate or demote themselves. Since only superadmins
 * can reach this route, that alone guarantees at least one active superadmin
 * always remains, so nobody can lock the whole team out of Admin.
 */
export function assertNotSelfLockout(
  actorId: number,
  targetId: number,
  patch: { role?: Role; isActive?: boolean }
): void {
  if (actorId !== targetId) return;
  if (patch.isActive === false) {
    throw new HttpError(400, 'self_lockout', 'You cannot deactivate your own account.');
  }
  if (patch.role !== undefined && patch.role !== 'superadmin') {
    throw new HttpError(400, 'self_lockout', 'You cannot remove your own superadmin role.');
  }
}

export function parseUserId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(404, 'not_found', 'User not found.');
  }
  return id;
}
