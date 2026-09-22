import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { QueuePage, QueueQuery } from '../../db/queue';

const listQueue = jest.fn<Promise<QueuePage>, [QueueQuery]>();
jest.mock('../../db/queue', () => ({ listQueue: (q: QueueQuery) => listQueue(q) }));

const PASSWORD = 'correct-horse-battery';

const PAGE: QueuePage = {
  leads: [],
  counts: { all: 0 },
  sources: [],
  total: 0,
  limit: 100,
};

beforeEach(() => {
  listQueue.mockReset();
  listQueue.mockResolvedValue(PAGE);
});

async function setup() {
  const { app, users } = await buildApp();
  await seedUser(users, { email: 'maya@example.com', password: PASSWORD });
  const agent = await signIn(app, 'maya@example.com', PASSWORD);
  return { app, users, agent };
}

/** What the route asked the database for, on its single call. */
function askedFor(): QueueQuery {
  expect(listQueue).toHaveBeenCalledTimes(1);
  return listQueue.mock.calls[0][0];
}

describe('who can read the queue', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(401);
    expect(listQueue).not.toHaveBeenCalled();
  });

  it('lets an agent in - this is their screen', async () => {
    const { agent } = await setup();
    expect((await agent.get('/api/leads')).status).toBe(200);
  });

  it('lets a superadmin in too', async () => {
    const { app, users } = await setup();
    await seedUser(users, { email: 'boss@example.com', role: 'superadmin', password: PASSWORD });
    const boss = await signIn(app, 'boss@example.com', PASSWORD);
    expect((await boss.get('/api/leads')).status).toBe(200);
  });

  it('holds back a user still on a temporary password', async () => {
    const { app, users } = await setup();
    await seedUser(users, { email: 'new@example.com', password: PASSWORD, mustChangePassword: true });
    const fresh = await signIn(app, 'new@example.com', PASSWORD);

    const res = await fresh.get('/api/leads');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('password_change_required');
    expect(listQueue).not.toHaveBeenCalled();
  });

  it('turns away a deactivated agent mid-session', async () => {
    const { users, agent } = await setup();
    const maya = await users.findByEmail('maya@example.com');
    await users.update(maya!.id, { isActive: false });
    expect((await agent.get('/api/leads')).status).toBe(401);
  });
});

describe('the page it hands back', () => {
  it('returns what the query found, unchanged', async () => {
    const { agent } = await setup();
    const page: QueuePage = {
      leads: [
        {
          id: 7,
          phone: '+16025550100',
          firstName: 'Jeel',
          lastName: 'K',
          source: 'CORE-G-27',
          receivedAt: '2026-09-22T10:00:00.000Z',
          score: 90,
          tier: 'HOT',
          q1: '3',
          q2: '1',
          q3: '1',
          conversationStatus: 'completed',
          tag: { kind: 'new' },
        },
      ],
      counts: { all: 3, HOT: 1, WARM: 2 },
      sources: ['CORE-G-27'],
      total: 3,
      limit: 100,
    };
    listQueue.mockResolvedValue(page);

    const res = await agent.get('/api/leads');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(page);
  });

  it('is never cached - a queue a minute old is wrong', async () => {
    const { agent } = await setup();
    const res = await agent.get('/api/leads');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('the filters an agent sets', () => {
  it('asks for nothing in particular when no filter is set', async () => {
    const { agent } = await setup();
    await agent.get('/api/leads');
    expect(askedFor()).toEqual({ tier: undefined, source: undefined, since: undefined, q: undefined, limit: undefined });
  });

  it('takes several tiers at once, however they are typed', async () => {
    const { agent } = await setup();
    await agent.get('/api/leads?tier=hot,%20Warm');
    expect(askedFor().tier).toEqual(['HOT', 'WARM']);
  });

  it('takes several sources at once', async () => {
    const { agent } = await setup();
    await agent.get('/api/leads?source=CORE-G-27,CORE-G-31');
    expect(askedFor().source).toEqual(['CORE-G-27', 'CORE-G-31']);
  });

  it.each([
    ['1h', 3600_000],
    ['24h', 24 * 3600_000],
    ['7d', 7 * 24 * 3600_000],
    ['30d', 30 * 24 * 3600_000],
  ])('turns the %s window into a cutoff time', async (since, ago) => {
    const { agent } = await setup();
    const before = Date.now();
    await agent.get(`/api/leads?since=${since}`);

    const cutoff = askedFor().since!.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - ago - 1000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - ago);
  });

  it('treats "all" as no time limit', async () => {
    const { agent } = await setup();
    await agent.get('/api/leads?since=all');
    expect(askedFor().since).toBeUndefined();
  });

  it('trims the search box, and ignores it when it holds only spaces', async () => {
    const { agent } = await setup();
    await agent.get('/api/leads?q=%20%20jeel%20%20');
    expect(askedFor().q).toBe('jeel');

    listQueue.mockClear();
    await agent.get('/api/leads?q=%20%20');
    expect(askedFor().q).toBeUndefined();
  });

  it('passes a page size through', async () => {
    const { agent } = await setup();
    await agent.get('/api/leads?limit=25');
    expect(askedFor().limit).toBe(25);
  });

  it('ignores empty filter values rather than filtering on nothing', async () => {
    const { agent } = await setup();
    await agent.get('/api/leads?tier=&source=&q=&limit=');
    expect(askedFor()).toEqual({ tier: undefined, source: undefined, since: undefined, q: undefined, limit: undefined });
  });
});

describe('filters that make no sense', () => {
  it.each([
    ['tier=PLATINUM', 'invalid_tier'],
    ['tier=hot,PLATINUM', 'invalid_tier'],
    ['since=yesterday', 'invalid_since'],
    ['since=90d', 'invalid_since'],
    ['limit=0', 'invalid_limit'],
    ['limit=-5', 'invalid_limit'],
    ['limit=ten', 'invalid_limit'],
  ])('rejects ?%s with 400 %s and never runs the query', async (qs, code) => {
    const { agent } = await setup();
    const res = await agent.get(`/api/leads?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(code);
    expect(listQueue).not.toHaveBeenCalled();
  });
});
