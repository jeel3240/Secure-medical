/**
 * Creates the first superadmin. Nobody can sign in to create an account until
 * one exists, so this is the only way in on a fresh database.
 *
 *   docker compose exec api npm run dev:create-superadmin -- you@example.com "Your Name"
 *   (production: npm run create-superadmin -- ...)
 *
 * Prints a temporary password once. The user must set a new one at first sign-in.
 */
import '../config';
import { generateTemporaryPassword, hashPassword } from '../api/auth/password';
import { HttpError } from '../api/http';
import { parseCreateUser } from '../api/users/rules';
import { EmailTakenError } from '../api/users/types';
import { pool } from '../db/pool';
import { pgUserStore } from '../db/users';

async function main(): Promise<number> {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage: npm run create-superadmin -- <email> "<name>"');
    return 1;
  }

  let input;
  try {
    input = parseCreateUser({ email, name, role: 'superadmin' });
  } catch (err) {
    console.error(err instanceof HttpError ? err.message : err);
    return 1;
  }

  const temporaryPassword = generateTemporaryPassword();
  try {
    const user = await pgUserStore.create({
      ...input,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    });
    console.log(`Created superadmin ${user.name} <${user.email}> (id ${user.id}).`);
    console.log(`Temporary password: ${temporaryPassword}`);
    console.log('It is shown only this once. A new password is required at first sign-in.');
    return 0;
  } catch (err) {
    if (err instanceof EmailTakenError) {
      console.error(`A user with email ${input.email} already exists.`);
      return 1;
    }
    throw err;
  }
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    pool.end().finally(() => process.exit(1));
  });
