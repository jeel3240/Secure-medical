import request from 'supertest';
import { buildApp, seedUser, sessionCookieFrom, signIn, whoAmI } from './helpers';

const PASSWORD = 'correct-horse-battery';

async function setup() {
  const { app, users } = await buildApp();
  const boss = await seedUser(users, { email: 'boss@example.com', name: 'Boss', role: 'superadmin', password: PASSWORD });
  const admin = await signIn(app, 'boss@example.com', PASSWORD);
  return { app, users, boss, admin };
}

describe('access control', () => {
  it('rejects anonymous requests', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/users')).status).toBe(401);
  });

  it('rejects agents on every users route', async () => {
    const { app, users } = await setup();
    const maya = await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
    const agent = await signIn(app, 'maya@example.com', PASSWORD);

    const responses = [
      await agent.get('/api/users'),
      await agent.post('/api/users').send({ email: 'x@example.com', name: 'X', role: 'agent' }),
      await agent.patch(`/api/users/${maya.id}`).send({ role: 'superadmin' }),
      await agent.post(`/api/users/${maya.id}/reset-password`),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    }
  });

  it('applies a role change on the very next request', async () => {
    const { app, users, admin } = await setup();
    const maya = await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
    const agent = await signIn(app, 'maya@example.com', PASSWORD);
    expect((await agent.get('/api/users')).status).toBe(403);

    await admin.patch(`/api/users/${maya.id}`).send({ role: 'superadmin' });
    expect((await agent.get('/api/users')).status).toBe(200);
  });
});

describe('creating agents', () => {
  it('returns a one-time temporary password that works and forces a change', async () => {
    const { app, admin } = await setup();

    const res = await admin.post('/api/users').send({ email: ' New.Agent@Example.com ', name: '  Nia  ', role: 'agent' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'new.agent@example.com', name: 'Nia', role: 'agent', isActive: true, mustChangePassword: true });
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z2-9]{14}$/);

    const agent = await signIn(app, 'new.agent@example.com', res.body.temporaryPassword);
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.mustChangePassword).toBe(true);
  });

  it('does not expose temporary passwords in the list', async () => {
    const { admin } = await setup();
    await admin.post('/api/users').send({ email: 'nia@example.com', name: 'Nia', role: 'agent' });

    const list = await admin.get('/api/users');
    expect(list.status).toBe(200);
    expect(list.body.users).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toMatch(/temporaryPassword|passwordHash|sessionVersion/);
  });

  it('rejects a duplicate email with 409', async () => {
    const { admin } = await setup();
    await admin.post('/api/users').send({ email: 'nia@example.com', name: 'Nia', role: 'agent' });
    const dup = await admin.post('/api/users').send({ email: 'NIA@example.com', name: 'Nia 2', role: 'agent' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('email_taken');
  });

  it.each([
    [{ email: 'not-an-email', name: 'Nia', role: 'agent' }, 'invalid_email'],
    [{ email: 'nia@example.com', name: '   ', role: 'agent' }, 'invalid_name'],
    [{ email: 'nia@example.com', name: 'Nia', role: 'owner' }, 'invalid_role'],
    [{ email: 'nia@example.com', name: 'Nia' }, 'invalid_role'],
  ])('rejects invalid input %j', async (body, code) => {
    const { admin } = await setup();
    const res = await admin.post('/api/users').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(code);
  });
});

describe('updating agents', () => {
  it('deactivation signs the agent out immediately and blocks sign-in', async () => {
    const { app, users, admin } = await setup();
    const maya = await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
    const login = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
    const cookie = sessionCookieFrom(login);

    const res = await admin.patch(`/api/users/${maya.id}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(false);

    expect(await whoAmI(app, cookie)).toBeNull();
    expect((await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD })).status).toBe(401);

    // Reactivating restores sign-in, but the old token stays dead.
    await admin.patch(`/api/users/${maya.id}`).send({ isActive: true });
    expect(await whoAmI(app, cookie)).toBeNull();
    expect((await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD })).status).toBe(200);
  });

  it('prevents a superadmin from deactivating or demoting themselves', async () => {
    const { boss, admin } = await setup();

    const deactivate = await admin.patch(`/api/users/${boss.id}`).send({ isActive: false });
    expect(deactivate.status).toBe(400);
    expect(deactivate.body.error).toBe('self_lockout');

    const demote = await admin.patch(`/api/users/${boss.id}`).send({ role: 'agent' });
    expect(demote.status).toBe(400);
    expect(demote.body.error).toBe('self_lockout');

    const rename = await admin.patch(`/api/users/${boss.id}`).send({ name: 'Big Boss' });
    expect(rename.status).toBe(200);
    expect(rename.body.user.name).toBe('Big Boss');
  });

  it('lets a superadmin manage another superadmin', async () => {
    const { users, admin } = await setup();
    const other = await seedUser(users, { email: 'other@example.com', role: 'superadmin', password: PASSWORD });
    const res = await admin.patch(`/api/users/${other.id}`).send({ role: 'agent', isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'agent', isActive: false });
  });

  it('rejects an empty or invalid update', async () => {
    const { users, admin } = await setup();
    const maya = await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
    expect((await admin.patch(`/api/users/${maya.id}`).send({})).body.error).toBe('empty_update');
    expect((await admin.patch(`/api/users/${maya.id}`).send({ isActive: 'no' })).body.error).toBe('invalid_is_active');
  });

  it('returns 404 for an unknown or malformed id', async () => {
    const { admin } = await setup();
    expect((await admin.patch('/api/users/9999').send({ name: 'X' })).status).toBe(404);
    expect((await admin.patch('/api/users/abc').send({ name: 'X' })).status).toBe(404);
    expect((await admin.post('/api/users/9999/reset-password')).status).toBe(404);
  });
});

describe('resetting passwords', () => {
  it('issues a new temporary password and ends existing sessions', async () => {
    const { app, users, admin } = await setup();
    const maya = await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
    const login = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
    const cookie = sessionCookieFrom(login);

    const res = await admin.post(`/api/users/${maya.id}/reset-password`);
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z2-9]{14}$/);

    expect(await whoAmI(app, cookie)).toBeNull();
    expect((await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD })).status).toBe(401);
    expect(
      (await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: res.body.temporaryPassword })).status
    ).toBe(200);
  });

  it('refuses to reset your own password', async () => {
    const { boss, admin } = await setup();
    const res = await admin.post(`/api/users/${boss.id}/reset-password`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('use_change_password');
  });
});

describe('unknown API routes', () => {
  it('return JSON 404', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
