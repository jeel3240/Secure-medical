/**
 * The three read-only admin screens: Configuration, Overview and the DNC list.
 * The database layer is mocked; the route contract and the superadmin guard are
 * what is under test. The SQL is proved by scripts/admin-live-check.ts.
 *
 * Read-only is a decision, not an omission (Jeel, 2026-09-23), so these tests
 * also pin that no writer exists.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';

const getAdminConfig = jest.fn();
const getOverview = jest.fn();
const listDnc = jest.fn();

jest.mock('../../db/admin-config', () => ({ getAdminConfig: () => getAdminConfig() }));
jest.mock('../../db/admin-overview', () => ({ getOverview: (p: unknown) => getOverview(p) }));
jest.mock('../../db/admin-dnc', () => ({ listDnc: (q: unknown) => listDnc(q) }));

const PASSWORD = 'correct-horse-battery';

beforeEach(() => {
  getAdminConfig.mockReset().mockResolvedValue({ messages: [], scoring: {}, tiers: [] });
  getOverview.mockReset().mockResolvedValue({ period: 'today', kpis: {}, callsBuilt: false });
  listDnc.mockReset().mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    limit: 50,
    counts: { all: 0, blocked: 0, released: 0 },
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
    });

    const res = await boss.get('/api/admin/config');
    expect(res.status).toBe(200);
    expect(res.body.scoring.maxScore).toBe(100);
    expect(res.body.messages[0].key).toBe('question_1');
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

  it('says the call figures are not built yet', async () => {
    const { boss } = await setup();
    const res = await boss.get('/api/admin/overview');

    // So a superadmin can tell "nobody is calling" from "nothing records it".
    expect(res.body.callsBuilt).toBe(false);
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

  it.each(['0', '-1', 'two'])('rejects page=%s', async (page) => {
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
