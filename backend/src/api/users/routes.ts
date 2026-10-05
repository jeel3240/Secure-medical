import { Router } from 'express';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import type { AppDeps } from '../deps';
import { asyncHandler, HttpError } from '../http';
import { accountChanges, assertNotSelfLockout, parseCreateUser, parseUpdateUser, parseUserId } from './rules';
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
        await deps.activity.record({
          action: 'user.created',
          actorId: req.user!.id,
          subjectUserId: user.id,
          detail: { email: user.email, name: user.name, role: user.role },
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
      // The update overwrites the old values, so they are read first: the log
      // keeps what each changed field was and what it became. AUDIT.md.
      const before = await deps.users.findById(id);
      const updated = await deps.users.update(id, { ...patch, bumpSession: patch.isActive === false });
      if (!before || !updated) throw notFound();

      const changes = accountChanges(before, updated);
      if (Object.keys(changes).length > 0) {
        await deps.activity.record({
          action: 'user.updated',
          actorId: req.user!.id,
          subjectUserId: id,
          detail: { changes },
        });
      }
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
      // That it was reset, and by whom - never the password itself.
      await deps.activity.record({ action: 'user.password_reset', actorId: req.user!.id, subjectUserId: id });
      res.json({ user: toPublicUser(updated), temporaryPassword });
    })
  );

  return router;
}
