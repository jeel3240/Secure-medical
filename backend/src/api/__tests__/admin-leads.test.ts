/**
 * Admin > Leads: the route contract and its filters. The SQL is proved by
 * scripts/admin-leads-live-check.ts.
 *
 * A bad filter is refused with a 400, the same as on the queue and the DNC
 * list - until 2026-09-28 this route silently ignored one.
 */
import { buildApp, seedUser, signIn } from './helpers';

const listAdminLeads = jest.fn();

jest.mock('../../db/leads', () => ({
  listAdminLeads: (opts: unknown) => listAdminLeads(opts),
  listLeadSources: async () => [],
  lastPollAt: async () => null,
}));

const PASSWORD = 'correct-horse-battery';

beforeEach(() => {
  listAdminLeads.mockReset().mockResolvedValue({ rows: [], total: 0, page: 1, counts: {} });
});

async function setup() {
  const { app, users } = await buildApp();
  await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  await seedUser(users, { email: 'boss@example.com', name: 'Boss', role: 'superadmin', password: PASSWORD });
  return {
    agent: await signIn(app, 'maya@example.com', PASSWORD),
    boss: await signIn(app, 'boss@example.com', PASSWORD),
  };
}

it('turns away an agent', async () => {
  const { agent } = await setup();
  expect((await agent.get('/api/admin/leads')).status).toBe(403);
  expect(listAdminLeads).not.toHaveBeenCalled();
});

it('reads absent, empty and all as no filter', async () => {
  const { boss } = await setup();
  for (const qs of ['', 'status=&since=', 'status=all&since=all']) {
    expect((await boss.get(`/api/admin/leads?${qs}`)).status).toBe(200);
  }
  for (const [opts] of listAdminLeads.mock.calls) {
    expect(opts).toMatchObject({ status: 'all', since: undefined });
  }
});

it('passes a known status and time window through', async () => {
  const { boss } = await setup();
  const before = Date.now();
  expect((await boss.get('/api/admin/leads?status=working&since=24h')).status).toBe(200);
  const opts = listAdminLeads.mock.calls[0][0];
  expect(opts.status).toBe('working');
  expect(before - opts.since.getTime()).toBeGreaterThanOrEqual(24 * 3600_000 - 1000);
});

it.each([
  // The names retired on 2026-09-28 are refused, not quietly read as All.
  ['status=in_progress', 'invalid_status'],
  ['status=completed', 'invalid_status'],
  ['status=WORKING', 'invalid_status'],
  ['since=yesterday', 'invalid_since'],
  ['since=90d', 'invalid_since'],
])('rejects ?%s with 400 %s and never runs the query', async (qs, code) => {
  const { boss } = await setup();
  const res = await boss.get(`/api/admin/leads?${qs}`);
  expect(res.status).toBe(400);
  expect(res.body.error).toBe(code);
  expect(listAdminLeads).not.toHaveBeenCalled();
});
