import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

// Cost 12 is ~250ms per hash on a t3.medium: slow enough to resist offline
// guessing, fast enough for 10 agents signing in. Tests drop it to keep the
// suite quick; the value is stored in the hash, so both verify either way.
const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 12;

export const MIN_PASSWORD_LENGTH = 10;
// bcrypt silently ignores everything past 72 bytes, so a longer password would
// be accepted and then only partly checked. Reject it instead.
const MAX_PASSWORD_BYTES = 72;

// No 0/O, 1/l/I: temporary passwords are read off a screen and typed by hand.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 14;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | null = null;

/**
 * Runs a bcrypt comparison that can never succeed. Called when the email does
 * not exist or the account is inactive, so those responses take as long as a
 * wrong password and response time does not reveal which emails are real.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash('no-user-has-this-password', BCRYPT_COST);
  await bcrypt.compare(password, await dummyHash);
}

export function generateTemporaryPassword(): string {
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

/** Returns a message describing what is wrong, or null when the password is acceptable. */
export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.trim().length === 0) {
    return 'Enter a new password.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`;
  }
  return null;
}
