import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import type { AppDeps } from '../deps';
import { asyncHandler, HttpError } from '../http';
import { assertNotSelfLockout, parseCreateUser, parseUpdateUser, parseUserId } from './rules';
import { EmailTakenError, toPublicUser } from './types';

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'User not found.');
}

/** Superadmin-only account management. Temporary passwords are returned exactly once. */
export function usersRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requirePasswordChanged, requireRole('superadmin'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const users = await deps.users.list();
      res.json({ users: users.map(toPublicUser) });
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = parseCreateUser(req.body);
      const temporaryPassword = generateTemporaryPassword();

      try {
        const user = await deps.users.create({
          ...input,
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
        });
        res.status(201).json({ user: toPublicUser(user), temporaryPassword });
      } catch (err) {
        if (err instanceof EmailTakenError) {
          throw new HttpError(409, 'email_taken', 'A user with that email already exists.');
        }
        throw err;
      }
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = parseUserId(req.params.id);
      const patch = parseUpdateUser(req.body);
      assertNotSelfLockout(req.user!.id, id, patch);

      // Deactivating ends the user's sessions immediately. Role and name changes
      // need no bump: requireAuth re-reads the row on every request anyway.
      const updated = await deps.users.update(id, { ...patch, bumpSession: patch.isActive === false });
      if (!updated) throw notFound();
      res.json({ user: toPublicUser(updated) });
    })
  );

  router.post(
    '/:id/reset-password',
    asyncHandler(async (req, res) => {
      const id = parseUserId(req.params.id);
      if (id === req.user!.id) {
        throw new HttpError(400, 'use_change_password', 'Use Change password for your own account.');
      }

      const temporaryPassword = generateTemporaryPassword();
      const updated = await deps.users.update(id, {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        bumpSession: true,
      });
      if (!updated) throw notFound();
      res.json({ user: toPublicUser(updated), temporaryPassword });
    })
  );

  return router;
}
