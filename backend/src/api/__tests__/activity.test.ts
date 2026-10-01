/**
 * What the routes write to the activity log - AUDIT.md.
 *
 * Sign-ins and account changes are recorded through `deps.activity`, so they
 * are checked here against a recorder that keeps them in memory. The writes on
 * a lead record themselves inside their own SQL, proved by
 * scripts/activity-live-check.ts.
 */
import request from 'supertest';
import { accountChanges } from '../users/rules';
import { buildApp, seedUser, signIn } from './helpers';

const PASSWORD = 'correct-horse-battery';

async function setup() {
  const built = await buildApp();
  const boss = await seedUser(built.users, { email: 'boss@example.com', name: 'Boss', role: 'superadmin', password: PASSWORD });
  const maya = await seedUser(built.users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  return { ...built, boss, maya };
}

describe('signing in and out', () => {
  it('records a sign-in, a sign-out and a password change, by whom', async () => {
    const { app, activity, maya } = await setup();
    const agent = await signIn(app, 'maya@example.com', PASSWORD);
    await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'another-good-passphrase' });
    await agent.post('/api/auth/logout');

    expect(activity.map((a) => [a.action, a.actorId])).toEqual([
      ['auth.signed_in', maya.id],
      ['auth.password_changed', maya.id],
      ['auth.signed_out', maya.id],
    ]);
  });

  it.each([
    ['a wrong password', 'maya@example.com', 'not-the-password', 'wrong_password', true],
    ['an email nobody has', 'nobody@example.com', PASSWORD, 'unknown_email', false],
  ])('records %s, with the email tried and never the password', async (_, email, password, why, known) => {
    const { app, activity, maya } = await setup();
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(401);
    expect(activity).toEqual([
      { action: 'auth.sign_in_failed', actorId: null, subjectUserId: known ? maya.id : null, detail: { email, why } },
    ]);
    expect(JSON.stringify(activity)).not.toContain(password);
  });

  it('records a deactivated account trying to sign in', async () => {
    const { app, activity, users, maya } = await setup();
    await users.update(maya.id, { isActive: false });
    await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
    expect(activity[0]).toMatchObject({ action: 'auth.sign_in_failed', detail: { why: 'inactive' } });
  });
});

describe('a superadmin changing accounts', () => {
  it('records a new account, by whom, and never its temporary password', async () => {
    const { app, activity, boss } = await setup();
    const admin = await signIn(app, 'boss@example.com', PASSWORD);
    const res = await admin.post('/api/users').send({ email: 'sam@example.com', name: 'Sam', role: 'agent' });

    const created = activity.find((a) => a.action === 'user.created');
    expect(created).toEqual({
      action: 'user.created',
      actorId: boss.id,
      subjectUserId: res.body.user.id,
      detail: { email: 'sam@example.com', name: 'Sam', role: 'agent' },
    });
    expect(JSON.stringify(activity)).not.toContain(res.body.temporaryPassword);
  });

  it('records what an update changed, as it was and as it became', async () => {
    const { app, activity, boss, maya } = await setup();
    const admin = await signIn(app, 'boss@example.com', PASSWORD);
    await admin.patch(`/api/users/${maya.id}`).send({ isActive: false, name: 'Maya' });

    expect(activity.find((a) => a.action === 'user.updated')).toEqual({
      action: 'user.updated',
      actorId: boss.id,
      subjectUserId: maya.id,
      // The name was sent but not changed, so it is not in the record.
      detail: { changes: { isActive: { from: true, to: false } } },
    });
  });

  it('records a password reset, without the password', async () => {
    const { app, activity, boss, maya } = await setup();
    const admin = await signIn(app, 'boss@example.com', PASSWORD);
    const res = await admin.post(`/api/users/${maya.id}/reset-password`);

    expect(activity.find((a) => a.action === 'user.password_reset')).toEqual({
      action: 'user.password_reset',
      actorId: boss.id,
      subjectUserId: maya.id,
    });
    expect(JSON.stringify(activity)).not.toContain(res.body.temporaryPassword);
  });
});

describe('what changed on an account', () => {
  const maya = { name: 'Maya', role: 'agent' as const, isActive: true };

  it('names each changed field with both values', () => {
    expect(accountChanges(maya, { name: 'Maya Chen', role: 'superadmin', isActive: true })).toEqual({
      name: { from: 'Maya', to: 'Maya Chen' },
      role: { from: 'agent', to: 'superadmin' },
    });
  });

  it('is empty when nothing changed', () => {
    expect(accountChanges(maya, { ...maya })).toEqual({});
  });
});
