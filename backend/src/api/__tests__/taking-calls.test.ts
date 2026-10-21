/**
 * The "Taking calls" switch - T10, AUTO-CALLS.md "Who is free".
 *
 * Only people who switched it on are rung for a transfer from an automated
 * call. It is switched by hand, and off at every sign-in and sign-out; every
 * change is in the activity log, and nothing that did not change is. Who is
 * free - the switch with the browser open and no call - is SQL, proved by
 * scripts/presence-live-check.ts.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';

const PASSWORD = 'correct-horse-battery';

async function setup(opts: { autoCalls?: boolean } = { autoCalls: true }) {
  const built = await buildApp({ autoCalls: opts.autoCalls });
  const maya = await seedUser(built.users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  return { ...built, maya, agent: await signIn(built.app, 'maya@example.com', PASSWORD) };
}

/** The switch's own rows in the activity log, as [on, why]. */
const switches = (activity: { action: string; detail?: Record<string, unknown> }[]) =>
  activity.filter((a) => a.action === 'calls.availability_changed').map((a) => [a.detail?.on, a.detail?.why]);

describe('switching it by hand', () => {
  it('on, then off: saved, answered, and each recorded as the person’s own doing', async () => {
    const { agent, users, activity, maya } = await setup();

    const on = await agent.post('/api/calls/taking-calls').send({ on: true });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ takingCalls: true, takingCallsWhy: 'by_hand' });
    expect((await users.findById(maya.id))!.takingCalls).toBe(true);

    const off = await agent.post('/api/calls/taking-calls').send({ on: false });
    expect(off.body).toEqual({ takingCalls: false, takingCallsWhy: 'by_hand' });
    expect((await users.findById(maya.id))!.takingCalls).toBe(false);

    const rows = activity.filter((a) => a.action === 'calls.availability_changed');
    expect(rows).toEqual([
      { action: 'calls.availability_changed', actorId: maya.id, detail: { on: true, why: 'by_hand' } },
      { action: 'calls.availability_changed', actorId: maya.id, detail: { on: false, why: 'by_hand' } },
    ]);
  });

  it('saying what it already is records nothing - only a change is a change - and keeps its reason', async () => {
    const { agent, activity } = await setup();
    expect((await agent.post('/api/calls/taking-calls').send({ on: false })).body).toEqual({
      takingCalls: false,
      takingCallsWhy: 'sign_in',
    });
    await agent.post('/api/calls/taking-calls').send({ on: true });
    await agent.post('/api/calls/taking-calls').send({ on: true });
    expect(switches(activity)).toEqual([[true, 'by_hand']]);
  });

  it('the signed-in person shows it, and only for themselves', async () => {
    const { agent, app, users } = await setup();
    await seedUser(users, { email: 'sam@example.com', name: 'Sam', password: PASSWORD });
    await agent.post('/api/calls/taking-calls').send({ on: true });
    expect((await agent.get('/api/auth/me')).body.user.takingCalls).toBe(true);
    const sam = await signIn(app, 'sam@example.com', PASSWORD);
    expect((await sam.get('/api/auth/me')).body.user.takingCalls).toBe(false);
  });

  it.each([
    ['nothing', undefined],
    ['a string', { on: 'true' }],
    ['a number', { on: 1 }],
    ['null', { on: null }],
  ])('anything but true or false - %s - is refused, and nothing changes', async (_, body) => {
    const { agent, activity } = await setup();
    const res = await agent.post('/api/calls/taking-calls').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_on');
    expect(switches(activity)).toEqual([]);
  });

  it('needs a session', async () => {
    const { app } = await setup();
    expect((await request(app).post('/api/calls/taking-calls').send({ on: true })).status).toBe(401);
  });

  it('is refused while automated calls are off - the switch is not shown, and nothing would ring', async () => {
    const { agent, activity } = await setup({ autoCalls: false });
    const res = await agent.post('/api/calls/taking-calls').send({ on: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('auto_calls_off');
    expect(switches(activity)).toEqual([]);
  });
});

describe('off at every sign-in and sign-out', () => {
  it('signing out turns it off, recorded after the sign-out itself', async () => {
    const { agent, users, activity, maya } = await setup();
    await agent.post('/api/calls/taking-calls').send({ on: true });
    await agent.post('/api/auth/logout');

    expect((await users.findById(maya.id))!.takingCalls).toBe(false);
    expect(activity.map((a) => a.action).slice(-2)).toEqual(['auth.signed_out', 'calls.availability_changed']);
    expect(switches(activity)).toEqual([
      [true, 'by_hand'],
      [false, 'sign_out'],
    ]);
  });

  it('signing in turns it off - left on in another browser, it does not carry over', async () => {
    const { agent, app, users, activity, maya } = await setup();
    await agent.post('/api/calls/taking-calls').send({ on: true });

    const res = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
    expect(res.body.user).toMatchObject({ takingCalls: false, takingCallsWhy: 'sign_in' });
    expect((await users.findById(maya.id))!.takingCalls).toBe(false);
    expect(activity.map((a) => a.action).slice(-2)).toEqual(['auth.signed_in', 'calls.availability_changed']);
    expect(switches(activity)).toEqual([
      [true, 'by_hand'],
      [false, 'sign_in'],
    ]);
  });

  it('when it was already off, signing in and out record nothing about it', async () => {
    const { agent, app, activity } = await setup();
    await agent.post('/api/auth/logout');
    await signIn(app, 'maya@example.com', PASSWORD);
    expect(switches(activity)).toEqual([]);
  });

  it('off because of a missed transfer, a sign-in gives it a new reason - yesterday\'s miss is not shown today', async () => {
    const { app, users, maya } = await setup();
    await users.update(maya.id, { takingCalls: { on: false, why: 'missed_transfer' } });
    const res = await request(app).post('/api/auth/login').send({ email: 'maya@example.com', password: PASSWORD });
    expect(res.body.user.takingCallsWhy).toBe('sign_in');
    expect((await users.findById(maya.id))!.takingCallsWhy).toBe('sign_in');
  });

  it('signing out gives it its reason', async () => {
    const { agent, users, maya } = await setup();
    await agent.post('/api/calls/taking-calls').send({ on: true });
    await agent.post('/api/auth/logout');
    expect((await users.findById(maya.id))!.takingCallsWhy).toBe('sign_out');
  });
});

describe('the config the browser reads', () => {
  it('says whether automated calls are on, beside calling itself', async () => {
    const off = await setup({ autoCalls: false });
    expect((await off.agent.get('/api/calls/config')).body.autoCalls).toBe(false);
    const on = await setup({ autoCalls: true });
    expect((await on.agent.get('/api/calls/config')).body.autoCalls).toBe(true);
  });
});
