import { generateTemporaryPassword, hashPassword, validateNewPassword, verifyPassword } from './password';

describe('validateNewPassword', () => {
  it.each([
    [undefined, 'Enter a new password.'],
    ['', 'Enter a new password.'],
    ['            ', 'Enter a new password.'],
    ['short', 'Password must be at least 10 characters.'],
    ['x'.repeat(73), 'Password must be at most 72 bytes.'],
    // 25 three-byte characters: 25 chars but 75 bytes, past bcrypt's limit.
    ['€'.repeat(25), 'Password must be at most 72 bytes.'],
  ])('rejects %j', (input, message) => {
    expect(validateNewPassword(input)).toBe(message);
  });

  it('accepts a 10 to 72 byte password', () => {
    expect(validateNewPassword('0123456789')).toBeNull();
    expect(validateNewPassword('x'.repeat(72))).toBeNull();
  });
});

describe('generateTemporaryPassword', () => {
  it('uses only unambiguous characters and is long enough to pass validation', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/);
      expect(validateNewPassword(pw)).toBeNull();
    }
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, generateTemporaryPassword));
    expect(seen.size).toBe(500);
  });
});

describe('hashPassword', () => {
  it('round-trips and never stores the plain text', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).not.toContain('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('wrong-horse-battery', hash)).toBe(false);
  });
});
