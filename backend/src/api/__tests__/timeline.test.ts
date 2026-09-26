/**
 * `GET /api/leads/:id/timeline`. The database layer is mocked; the route
 * contract is what is under test. The merge, the ordering and the derived
 * system events are proved by scripts/timeline-live-check.ts.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { TimelineEntry } from '../../db/timeline';

const getTimeline = jest.fn<Promise<TimelineEntry[] | null>, [number]>();
jest.mock('../../db/timeline', () => ({ getTimeline: (id: number) => getTimeline(id) }));

const PASSWORD = 'correct-horse-battery';

const ENTRIES: TimelineEntry[] = [
  {
    kind: 'system',
    at: '2026-09-26T09:00:00.000Z',
    author: null,
    detail: { event: 'lead_received', source: 'API' },
  },
  {
    kind: 'sms',
    at: '2026-09-26T09:00:02.000Z',
    author: null,
    detail: { body: 'Secure Medical: Hi...', deliveryStatus: null },
  },
  { kind: 'inbound', at: '2026-09-26T09:04:00.000Z', author: null, detail: { body: '3' } },
  { kind: 'note', at: '2026-09-26T09:10:00.000Z', author: 'Maya', detail: { body: 'Called, no answer' } },
];

beforeEach(() => {
  getTimeline.mockReset();
  getTimeline.mockResolvedValue(ENTRIES);
});

async function setup() {
  const { app, users } = await buildApp();
  await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  const agent = await signIn(app, 'maya@example.com', PASSWORD);
  return { app, agent };
}

describe('the lead timeline', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/leads/7/timeline');
    expect(res.status).toBe(401);
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it('returns the entries for a signed-in agent', async () => {
    const { agent } = await setup();
    const res = await agent.get('/api/leads/7/timeline');

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual(ENTRIES);
    expect(getTimeline).toHaveBeenCalledWith(7);
  });

  it('returns an empty list for a lead with no history', async () => {
    const { agent } = await setup();
    getTimeline.mockResolvedValue([]);

    const res = await agent.get('/api/leads/7/timeline');
    // Empty is a real answer, not a 404.
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    getTimeline.mockResolvedValue(null);

    const res = await agent.get('/api/leads/999/timeline');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('rejects a lead id that is not a positive whole number', async () => {
    const { agent } = await setup();
    for (const bad of ['abc', '0', '-1', '1.5']) {
      expect((await agent.get(`/api/leads/${bad}/timeline`)).status).toBe(400);
    }
    expect(getTimeline).not.toHaveBeenCalled();
  });
});
