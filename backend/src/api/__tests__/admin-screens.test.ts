/**
 * The three read-only admin screens: Configuration, Overview and the DNC list.
 * The database layer is mocked; the route contract and the superadmin guard are
 * what is under test. The SQL is proved by scripts/admin-live-check.ts.
 *
 * Read-only is a decision, not an omission (Jeel, 2026-09-23), so these tests
 * also pin that no writer exists - but one: Seri's switch on Configuration
 * (Jeel, 2026-11-24), its own route, tested below.
 */
import request from 'supertest';
import type { TwilioSettings } from '../../twilio-settings';
import { buildApp, seedUser, signIn } from './helpers';

const getAdminConfig = jest.fn();
const getOverview = jest.fn();
const listDnc = jest.fn();

jest.mock('../../db/admin-config', () => ({ getAdminConfig: (calling: unknown) => getAdminConfig(calling) }));
jest.mock('../../db/admin-overview', () => ({ getOverview: (p: unknown) => getOverview(p) }));
jest.mock('../../db/admin-dnc', () => ({ listDnc: (q: unknown) => listDnc(q) }));
const switchAiAgent = jest.fn();
jest.mock('../../ai/settings', () => ({
  ...jest.requireActual('../../ai/settings'),
  switchAiAgent: (...a: unknown[]) => switchAiAgent(...a),
}));
jest.mock('../../db/pool', () => ({ pool: { name: 'the pool' } }));

const PASSWORD = 'correct-horse-battery';

beforeEach(() => {
  getAdminConfig.mockReset().mockResolvedValue({ messages: [], scoring: {}, tiers: [] });
  getOverview.mockReset().mockResolvedValue({ period: 'today', kpis: {}, agents: [], activity: [] });
  listDnc.mockReset().mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    limit: 50,
    counts: { all: 0, blocked: 0, released: 0 },
  });
});

async function setup(opts: { twilio?: TwilioSettings | null; autoCalls?: boolean; openAiKey?: string } = {}) {
  const { app, users } = await buildApp(opts);
  await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  const bossUser = await seedUser(users, {
    email: 'boss@example.com',
    name: 'Boss',
    role: 'superadmin',
    password: PASSWORD,
  });
  const agent = await signIn(app, 'maya@example.com', PASSWORD);
  const boss = await signIn(app, 'boss@example.com', PASSWORD);
  return { app, agent, boss, bossId: bossUser.id };
}

describe.each([
  ['/api/admin/config', () => getAdminConfig],
  ['/api/admin/overview', () => getOverview],
  ['/api/admin/dnc', () => listDnc],
])('%s', (path, mock) => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    expect((await request(app).get(path)).status).toBe(401);
    expect(mock()).not.toHaveBeenCalled();
  });

  it('turns away an agent', async () => {
    const { agent } = await setup();
    // The per-agent table and activity feed are the only place one agent's
    // work is visible to anyone but themselves - AUTH.md.
    expect((await agent.get(path)).status).toBe(403);
    expect(mock()).not.toHaveBeenCalled();
  });

  it('lets a superadmin in', async () => {
    const { boss } = await setup();
    expect((await boss.get(path)).status).toBe(200);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('has no %s', async (method) => {
    const { boss } = await setup();
    // Read-only is a decision, not an omission: Jeel, 2026-09-23.
    expect((await boss[method](path).send({})).status).toBe(404);
  });
});

describe('Configuration', () => {
  it('returns the live values', async () => {
    const { boss } = await setup();
    getAdminConfig.mockResolvedValue({
      messages: [{ key: 'question_1', body: 'Hi', segments: 1, costsExtraSegment: false }],
      scoring: { awards: [], questions: [], maxScore: 100 },
      tiers: [{ name: 'HOT', minScore: 75, maxScore: 100 }],
      settings: { expiryDays: 7, maxInvalidBeforeReview: 1, segmentLimit: 160 },
      longestFirstName: 'Christopher',
      longestNameIsFallback: false,
    });

    const res = await boss.get('/api/admin/config');
    expect(res.status).toBe(200);
    expect(res.body.scoring.maxScore).toBe(100);
    expect(res.body.messages[0].key).toBe('question_1');
  });

  // What only the api knows about calls, for the call script and its settings - T24.
  const TWILIO: TwilioSettings = {
    accountSid: `AC${'1'.repeat(32)}`,
    authToken: 'f'.repeat(32),
    apiKey: `SK${'2'.repeat(32)}`,
    apiSecret: 'S'.repeat(32),
    twimlAppSid: `AP${'3'.repeat(32)}`,
    callerId: '+14805308582',
    publicUrl: 'https://calls.example.com',
    identityPrefix: 'dev-',
  };

  it('tells the read model whether automated calls are on, the calling number, and whether calls are recorded', async () => {
    const { boss } = await setup({ twilio: { ...TWILIO, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, autoCalls: true });
    expect((await boss.get('/api/admin/config')).status).toBe(200);
    expect(getAdminConfig).toHaveBeenCalledWith({ autoCalls: true, callbackNumber: '+14805308582', recorded: true, openAiKeySet: false });
  });

  it('calling set up, automated calls off, nothing recorded', async () => {
    const { boss } = await setup({ twilio: TWILIO, autoCalls: false });
    await boss.get('/api/admin/config');
    expect(getAdminConfig).toHaveBeenCalledWith({ autoCalls: false, callbackNumber: '+14805308582', recorded: false, openAiKeySet: false });
  });

  it('calling not set up: off, no number', async () => {
    const { boss } = await setup();
    await boss.get('/api/admin/config');
    expect(getAdminConfig).toHaveBeenCalledWith({ autoCalls: false, callbackNumber: null, recorded: false, openAiKeySet: false });
  });
});

describe("Seri's switch on Configuration (Jeel, 2026-11-24)", () => {
  const PATH = '/api/admin/config/ai-agent';
  beforeEach(() => {
    switchAiAgent.mockReset().mockResolvedValue({ from: 'off', to: 'on', changed: true });
  });

  it('tells the read model whether the key is set', async () => {
    const { boss } = await setup({ openAiKey: 'sk-test' });
    await boss.get('/api/admin/config');
    expect(getAdminConfig).toHaveBeenCalledWith(expect.objectContaining({ openAiKeySet: true }));
  });

  it('turns away anyone not signed in, and an agent', async () => {
    const { app, agent } = await setup({ openAiKey: 'sk-test' });
    expect((await request(app).post(PATH).send({ on: true })).status).toBe(401);
    expect((await agent.post(PATH).send({ on: true })).status).toBe(403);
    expect(switchAiAgent).not.toHaveBeenCalled();
  });

  it('switches it on, recorded as by this superadmin, from the website', async () => {
    const { boss, bossId } = await setup({ openAiKey: 'sk-test' });
    const res = await boss.post(PATH).send({ on: true });
    expect([res.status, res.body]).toEqual([200, { on: true, changed: true }]);
    expect(switchAiAgent).toHaveBeenCalledWith({ name: 'the pool' }, 'on', { via: 'website', userId: bossId });
  });

  it('refuses on without the key, and changes nothing', async () => {
    const { boss } = await setup();
    const res = await boss.post(PATH).send({ on: true });
    expect([res.status, res.body.error]).toEqual([409, 'no_key']);
    expect(switchAiAgent).not.toHaveBeenCalled();
  });

  it('off needs no key - she can always be stopped', async () => {
    const { boss, bossId } = await setup();
    switchAiAgent.mockResolvedValue({ from: 'on', to: 'off', changed: true });
    expect((await boss.post(PATH).send({ on: false })).status).toBe(200);
    expect(switchAiAgent).toHaveBeenCalledWith({ name: 'the pool' }, 'off', { via: 'website', userId: bossId });
  });

  it.each([[{}], [{ on: 'yes' }], [{ on: 1 }]])('refuses a body that is not on or off: %j', async (body) => {
    const { boss } = await setup({ openAiKey: 'sk-test' });
    expect((await boss.post(PATH).send(body)).status).toBe(400);
    expect(switchAiAgent).not.toHaveBeenCalled();
  });
});

describe('Overview', () => {
  it('defaults to today', async () => {
    const { boss } = await setup();
    await boss.get('/api/admin/overview');
    expect(getOverview).toHaveBeenCalledWith('today');
  });

  it.each(['today', '7d', '30d'])('accepts period=%s', async (period) => {
    const { boss } = await setup();
    expect((await boss.get(`/api/admin/overview?period=${period}`)).status).toBe(200);
    expect(getOverview).toHaveBeenCalledWith(period);
  });

  it('rejects an unknown period', async () => {
    const { boss } = await setup();
    const res = await boss.get('/api/admin/overview?period=all-time');

    expect(res.status).toBe(400);
    expect(getOverview).not.toHaveBeenCalled();
  });

  it('returns what the page shows and no call figures - removed 2026-09-28', async () => {
    const { boss } = await setup();
    const res = await boss.get('/api/admin/overview');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('callsBuilt');
    expect(res.body).not.toHaveProperty('funnel');
  });
});

describe('the DNC list', () => {
  it('shows every row by default, released included', async () => {
    const { boss } = await setup();
    await boss.get('/api/admin/dnc');

    // Hiding released rows would stop the list matching who is blocked.
    expect(listDnc.mock.calls[0][0].state).toBe('all');
  });

  it.each(['all', 'blocked', 'released'])('accepts state=%s', async (state) => {
    const { boss } = await setup();
    expect((await boss.get(`/api/admin/dnc?state=${state}`)).status).toBe(200);
    expect(listDnc.mock.calls[0][0].state).toBe(state);
  });

  it('rejects an unknown state', async () => {
    const { boss } = await setup();
    expect((await boss.get('/api/admin/dnc?state=deleted')).status).toBe(400);
    expect(listDnc).not.toHaveBeenCalled();
  });

  it('passes the search through', async () => {
    const { boss } = await setup();
    await boss.get('/api/admin/dnc?q=602');
    expect(listDnc.mock.calls[0][0].q).toBe('602');
  });

  it('pages', async () => {
    const { boss } = await setup();
    await boss.get('/api/admin/dnc?page=3');
    expect(listDnc.mock.calls[0][0].page).toBe(3);
  });

  it.each(['0', '-1', 'two', '1e20', '100001', '2.5'])('rejects page=%s - a 400, never a 500 from the offset (review M17)', async (page) => {
    const { boss } = await setup();
    expect((await boss.get(`/api/admin/dnc?page=${page}`)).status).toBe(400);
    expect(listDnc).not.toHaveBeenCalled();
  });

  it('returns the counts for every tab', async () => {
    const { boss } = await setup();
    listDnc.mockResolvedValue({
      rows: [],
      total: 3,
      page: 1,
      limit: 50,
      counts: { all: 5, blocked: 3, released: 2 },
    });

    const res = await boss.get('/api/admin/dnc?state=blocked');
    expect(res.body.counts).toEqual({ all: 5, blocked: 3, released: 2 });
  });
});
