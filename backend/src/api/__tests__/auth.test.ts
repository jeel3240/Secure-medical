import jwt from 'jsonwebtoken';
import request from 'supertest';
import { buildApp, JWT_SECRET, seedUser, sessionCookieFrom, signIn, whoAmI } from './helpers';

const PASSWORD = 'correct-horse-battery';

describe('POST /api/auth/login', () => {
  it('sets an httpOnly SameSite=Strict session cookie and returns the user without secrets', async () => {
    const { app, users } = await buildApp();
    await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });

    const res = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'maya@example.com', name: 'Maya', role: 'agent' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.sessionVersion).toBeUndefined();
    expect(res.body.user.lastLoginAt).not.toBeNull();

    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/sm_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('treats email case-insensitively', async () => {
    const { app, users } = await buildApp();
    await seedUser(users, { email: 'maya@example.com', password: PASSWORD });

    const res = await request(app).post('/api/auth/login').send({ email: '  Maya@Example.COM ', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('gives the same response for wrong password, unknown email and a deactivated account', async () => {
    const { app, users } = await buildApp();
    const maya = await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
    await seedUser(users, { email: 'gone@example.com', password: PASSWORD });
    await users.update(maya.id + 1, { isActive: false });

    const attempts = [
      { email: 'maya@example.com', password: 'wrong-password-123' },
      { email: 'nobody@example.com', password: PASSWORD },
      { email: 'gone@example.com', password: PASSWORD },
    ];
    for (const body of attempts) {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('rejects a missing email or password with 400', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/auth/login').send({ email: 'maya@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('rejects malformed JSON with 400 rather than 500', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('rate limits after 10 failed attempts but does not count successful ones', async () => {
    const { app, users } = await buildApp();
    await seedUser(users, { email: 'maya@example.com', password: PASSWORD });

    for (let i = 0; i < 20; i++) {
      const ok = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
      expect(ok.status).toBe(200);
    }
    for (let i = 0; i < 10; i++) {
      const bad = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: 'nope-nope-nope' });
      expect(bad.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('too_many_attempts');
  });
});

describe('session handling', () => {
  it('GET /api/auth/me answers null, not 401, when signed out', async () => {
    const { app, users } = await buildApp();
    await seedUser(users, { email: 'maya@example.com', password: PASSWORD });

    const anonymous = await request(app).get('/api/auth/me');
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual({ user: null });

    const agent = await signIn(app, 'maya@example.com', PASSWORD);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('maya@example.com');
  });

  it('protected routes still return 401 without a session', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/auth/change-password').send({ currentPassword: 'a', newPassword: 'b' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
  });

  it('clears a dead session cookie', async () => {
    const { app } = await buildApp();
    const res = await request(app).get('/api/auth/me').set('Cookie', 'sm_session=garbage');
    expect(res.body.user).toBeNull();
    const cleared = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cleared).toMatch(/sm_session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('rejects a token signed with a different secret', async () => {
    const { app, users } = await buildApp();
    const maya = await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
    const forged = jwt.sign({ sv: 0 }, 'some-other-secret', { subject: String(maya.id) });

    const res = await request(app).get('/api/auth/me').set('Cookie', `sm_session=${forged}`);
    expect(res.body.user).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { app, users } = await buildApp();
    const maya = await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
    const expired = jwt.sign({ sv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, JWT_SECRET, { subject: String(maya.id) });

    const res = await request(app).get('/api/auth/me').set('Cookie', `sm_session=${expired}`);
    expect(res.body.user).toBeNull();
  });

  it('logout ends the session server-side, so a copied token stops working', async () => {
    const { app, users } = await buildApp();
    await seedUser(users, { email: 'maya@example.com', password: PASSWORD });

    const login = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
    const cookie = sessionCookieFrom(login);

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);

    expect(await whoAmI(app, cookie)).toBeNull();
  });

  it('logout without a session still succeeds', async () => {
    const { app } = await buildApp();
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  });
});

describe('forced password change', () => {
  it('blocks other routes until the temporary password is replaced', async () => {
    const { app, users } = await buildApp();
    await seedUser(users, { email: 'boss@example.com', role: 'superadmin', password: PASSWORD, mustChangePassword: true });
    const agent = await signIn(app, 'boss@example.com', PASSWORD);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    const blocked = await agent.get('/api/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('password_change_required');
  });

  it('validates the change and then unblocks', async () => {
    const { app, users } = await buildApp();
    await seedUser(users, { email: 'boss@example.com', role: 'superadmin', password: PASSWORD, mustChangePassword: true });
    const agent = await signIn(app, 'boss@example.com', PASSWORD);

    const wrong = await agent.post('/api/auth/change-password').send({ currentPassword: 'not-it-at-all', newPassword: 'a-brand-new-one' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('wrong_current_password');

    const short = await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('weak_password');

    const same = await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe('password_unchanged');

    const tooLong = await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'x'.repeat(73) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe('weak_password');

    const ok = await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-one' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);

    // The cookie issued by change-password keeps this browser signed in.
    expect((await agent.get('/api/users')).status).toBe(200);

    // And the new password is the one that works now.
    const oldLogin = await request(app).post('/api/auth/login').send({ email: 'boss@example.com', password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ email: 'boss@example.com', password: 'a-brand-new-one' });
    expect(newLogin.status).toBe(200);
  });

  it('signs out other sessions when the password changes', async () => {
    const { app, users } = await buildApp();
    await seedUser(users, { email: 'maya@example.com', password: PASSWORD });

    const otherDevice = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
    const otherCookie = sessionCookieFrom(otherDevice);

    const agent = await signIn(app, 'maya@example.com', PASSWORD);
    await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-one' });

    expect(await whoAmI(app, otherCookie)).toBeNull();
    expect((await agent.get('/api/auth/me')).body.user).not.toBeNull();
  });
});
