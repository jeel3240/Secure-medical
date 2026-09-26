/**
 * The deep health endpoint. The database layer is mocked; the route contract
 * and the guard are what is under test. The checks themselves - what counts as
 * a stale poll, which column proves the worker is alive - are proved by
 * scripts/health-live-check.ts.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';

const getHealth = jest.fn();
jest.mock('../../db/health', () => ({ getHealth: () => getHealth() }));

const PASSWORD = 'correct-horse-battery';

const HEALTHY = {
  status: 'ok',
  checkedAt: '2026-09-26T10:00:00.000Z',
  checks: [{ name: 'database', status: 'ok', message: null, detail: { roundTripMs: 2 } }],
};

beforeEach(() => {
  getHealth.mockReset().mockResolvedValue(HEALTHY);
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

describe('the shallow health endpoint', () => {
  it('stays open and unchanged, for Caddy and the container check', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    // It must not touch the database: that is the whole difference between the
    // two endpoints.
    expect(getHealth).not.toHaveBeenCalled();
  });
});

describe('the deep health endpoint', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/admin/health')).status).toBe(401);
  });

  it('turns away an agent', async () => {
    const { agent } = await setup();
    expect((await agent.get('/api/admin/health')).status).toBe(403);
  });

  it('answers a superadmin', async () => {
    const { boss } = await setup();
    const res = await boss.get('/api/admin/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(HEALTHY);
  });

  it('answers 200 even when degraded', async () => {
    const { boss } = await setup();
    getHealth.mockResolvedValue({
      status: 'degraded',
      checkedAt: '2026-09-26T10:00:00.000Z',
      checks: [
        {
          name: 'poller',
          status: 'degraded',
          message: 'The last poll was 900s ago. The worker may not be running.',
          detail: { ageSeconds: 900 },
        },
      ],
    });

    const res = await boss.get('/api/admin/health');
    // The report is the point; the body's status field is the verdict.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks[0].message).toMatch(/may not be running/);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('has no %s', async (method) => {
    const { boss } = await setup();
    expect((await boss[method]('/api/admin/health').send({})).status).toBe(404);
  });
});
