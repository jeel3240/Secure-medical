/**
 * Callbacks: creating one on a lead, listing them, rescheduling and completing.
 * The database layer is mocked; the route contract is what is under test.
 * The tab windows are proved by scripts/callbacks-live-check.ts.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { CallbackListResult, CreateResult, UpdateResult } from '../../db/callbacks';

const createCallback = jest.fn<Promise<CreateResult>, [number, number, Date]>();
const updateCallback = jest.fn<Promise<UpdateResult>, [number, number, boolean, any]>();
const listCallbacks = jest.fn<Promise<CallbackListResult>, [any]>();
jest.mock('../../db/callbacks', () => ({
  createCallback: (...a: [number, number, Date]) => createCallback(...a),
  updateCallback: (...a: [number, number, boolean, any]) => updateCallback(...a),
  listCallbacks: (o: any) => listCallbacks(o),
}));

const PASSWORD = 'correct-horse-battery';
const AT = '2026-09-27T17:15:00.000Z';

const A_CALLBACK = {
  id: 1,
  leadId: 7,
  agentId: 1,
  agentName: 'Maya',
  scheduledAt: AT,
  doneAt: null,
};

beforeEach(() => {
  createCallback.mockReset();
  updateCallback.mockReset();
  listCallbacks.mockReset();
  createCallback.mockResolvedValue({ ok: true, callback: A_CALLBACK });
  updateCallback.mockResolvedValue({ ok: true, callback: A_CALLBACK });
  listCallbacks.mockResolvedValue({
    callbacks: [],
    counts: { today: 0, upcoming: 0, overdue: 0, all: 0 },
  });
});

async function setup() {
  const { app, users } = await buildApp();
  await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  await seedUser(users, {
    email: 'boss@example.com',
    name: 'Boss',
    role: 'superadmin',
    password: PASSWORD,
  });
  const agent = await signIn(app, 'maya@example.com', PASSWORD);
  const boss = await signIn(app, 'boss@example.com', PASSWORD);
  return { app, agent, boss };
}

describe('creating a callback', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/leads/7/callbacks').send({ scheduledAt: AT });
    expect(res.status).toBe(401);
    expect(createCallback).not.toHaveBeenCalled();
  });

  it('books it for the caller by default', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/callbacks').send({ scheduledAt: AT });

    expect(res.status).toBe(201);
    expect(res.body.callback).toEqual(A_CALLBACK);
    const [leadId, , at] = createCallback.mock.calls[0];
    expect(leadId).toBe(7);
    expect(at.toISOString()).toBe(AT);
  });

  it('lets a superadmin book one for another agent', async () => {
    const { boss } = await setup();
    const res = await boss.post('/api/leads/7/callbacks').send({ scheduledAt: AT, agentId: 42 });

    expect(res.status).toBe(201);
    expect(createCallback.mock.calls[0][1]).toBe(42);
  });

  it('refuses when an agent tries to assign one to someone else', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/callbacks').send({ scheduledAt: AT, agentId: 42 });

    expect(res.status).toBe(403);
    expect(createCallback).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['empty', { scheduledAt: '' }],
    ['not a date', { scheduledAt: 'next tuesday' }],
    ['not a string', { scheduledAt: 1700000000 }],
  ])('rejects a scheduledAt that is %s', async (_label, payload) => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/callbacks').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scheduled_at');
    expect(createCallback).not.toHaveBeenCalled();
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    createCallback.mockResolvedValue({ ok: false, reason: 'lead_not_found' });

    const res = await agent.post('/api/leads/999/callbacks').send({ scheduledAt: AT });
    expect(res.status).toBe(404);
  });

  it('answers 400 when the agent does not exist', async () => {
    const { boss } = await setup();
    createCallback.mockResolvedValue({ ok: false, reason: 'agent_not_found' });

    const res = await boss.post('/api/leads/7/callbacks').send({ scheduledAt: AT, agentId: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_agent_id');
  });
});

describe('listing callbacks', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/callbacks')).status).toBe(401);
  });

  it('defaults to your own, today', async () => {
    const { agent } = await setup();
    const res = await agent.get('/api/callbacks');

    expect(res.status).toBe(200);
    expect(listCallbacks.mock.calls[0][0].when).toBe('today');
    expect(listCallbacks.mock.calls[0][0].agentId).toEqual(expect.any(Number));
  });

  it.each(['today', 'upcoming', 'overdue', 'all'])('accepts when=%s', async (when) => {
    const { agent } = await setup();
    expect((await agent.get(`/api/callbacks?when=${when}`)).status).toBe(200);
    expect(listCallbacks.mock.calls[0][0].when).toBe(when);
  });

  it('rejects an unknown when', async () => {
    const { agent } = await setup();
    const res = await agent.get('/api/callbacks?when=someday');

    expect(res.status).toBe(400);
    expect(listCallbacks).not.toHaveBeenCalled();
  });

  it("lets a superadmin read another agent's", async () => {
    const { boss } = await setup();
    const res = await boss.get('/api/callbacks?agentId=42');

    expect(res.status).toBe(200);
    expect(listCallbacks.mock.calls[0][0].agentId).toBe(42);
  });

  it('refuses an agent asking for someone else', async () => {
    const { agent } = await setup();
    const res = await agent.get('/api/callbacks?agentId=42');

    // An agent must never see another agent's work - DESIGN-PROMPT.md 1.
    expect(res.status).toBe(403);
    expect(listCallbacks).not.toHaveBeenCalled();
  });

  it('returns the counts for every tab', async () => {
    const { agent } = await setup();
    listCallbacks.mockResolvedValue({
      callbacks: [],
      counts: { today: 2, upcoming: 5, overdue: 1, all: 8 },
    });

    const res = await agent.get('/api/callbacks');
    // The overdue badge has to be right whichever tab is open.
    expect(res.body.counts).toEqual({ today: 2, upcoming: 5, overdue: 1, all: 8 });
  });
});

describe('changing a callback', () => {
  it('reschedules it', async () => {
    const { agent } = await setup();
    const res = await agent.patch('/api/callbacks/1').send({ scheduledAt: AT });

    expect(res.status).toBe(200);
    expect(updateCallback.mock.calls[0][3].scheduledAt.toISOString()).toBe(AT);
  });

  it('marks it done', async () => {
    const { agent } = await setup();
    const res = await agent.patch('/api/callbacks/1').send({ done: true });

    expect(res.status).toBe(200);
    expect(updateCallback.mock.calls[0][3].done).toBe(true);
  });

  it('tells the database layer whether the caller is a superadmin', async () => {
    const { agent, boss } = await setup();

    await agent.patch('/api/callbacks/1').send({ done: true });
    expect(updateCallback.mock.calls[0][2]).toBe(false);

    updateCallback.mockClear();
    await boss.patch('/api/callbacks/1').send({ done: true });
    expect(updateCallback.mock.calls[0][2]).toBe(true);
  });

  it('rejects a body that changes nothing', async () => {
    const { agent } = await setup();
    const res = await agent.patch('/api/callbacks/1').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('nothing_to_change');
    expect(updateCallback).not.toHaveBeenCalled();
  });

  it('rejects a done that is not a boolean', async () => {
    const { agent } = await setup();
    const res = await agent.patch('/api/callbacks/1').send({ done: 'yes' });

    expect(res.status).toBe(400);
    expect(updateCallback).not.toHaveBeenCalled();
  });

  it("refuses someone else's callback", async () => {
    const { agent } = await setup();
    updateCallback.mockResolvedValue({ ok: false, reason: 'not_yours', ownerName: 'Sam' });

    const res = await agent.patch('/api/callbacks/1').send({ done: true });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Sam');
  });

  it('answers 404 for a callback that does not exist', async () => {
    const { agent } = await setup();
    updateCallback.mockResolvedValue({ ok: false, reason: 'not_found' });

    expect((await agent.patch('/api/callbacks/999').send({ done: true })).status).toBe(404);
  });
});
