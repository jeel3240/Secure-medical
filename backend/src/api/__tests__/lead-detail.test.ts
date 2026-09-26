/**
 * `GET /api/leads/:id`. The database layer is mocked; the route contract is
 * what is under test. The SQL is proved by scripts/lead-detail-live-check.ts.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { LeadDetail } from '../../db/lead-detail';

const getLeadDetail = jest.fn<Promise<LeadDetail | null>, [number]>();
jest.mock('../../db/lead-detail', () => ({ getLeadDetail: (id: number) => getLeadDetail(id) }));

const markLeadRead = jest.fn();
jest.mock('../../db/read-flag', () => ({ markLeadRead: (id: number) => markLeadRead(id) }));

const PASSWORD = 'correct-horse-battery';

const A_LEAD: LeadDetail = {
  id: 7,
  phone: '+16025550142',
  firstName: 'Jordan',
  lastName: 'Meyer',
  email: null,
  source: 'API',
  receivedAt: '2026-09-26T09:00:00.000Z',
  conversation: {
    id: 3,
    status: 'completed',
    step: 3,
    score: 100,
    tier: 'HOT',
    expiresAt: null,
    agentTookOverAt: null,
  },
  chips: [
    { question: 1, heading: 'Interest', answer: 'Both' },
    { question: 2, heading: 'Timing', answer: 'Today' },
    { question: 3, heading: 'Prefers', answer: 'Call me now' },
  ],
  breakdown: [
    { code: 'responded', label: 'Responded', points: 10 },
    { code: 'q1_3', label: 'Both', points: 15 },
  ],
  claimedBy: null,
  flags: { dnc: false, needsReview: false, unread: false, expired: false },
};

beforeEach(() => {
  getLeadDetail.mockReset();
  markLeadRead.mockReset();
  getLeadDetail.mockResolvedValue(A_LEAD);
});

async function setup() {
  const { app, users } = await buildApp();
  await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  const agent = await signIn(app, 'maya@example.com', PASSWORD);
  return { app, agent };
}

describe('the lead card', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/leads/7');
    expect(res.status).toBe(401);
    expect(getLeadDetail).not.toHaveBeenCalled();
  });

  it('returns the lead for a signed-in agent', async () => {
    const { agent } = await setup();
    const res = await agent.get('/api/leads/7');

    expect(res.status).toBe(200);
    expect(res.body.lead).toEqual(A_LEAD);
    expect(getLeadDetail).toHaveBeenCalledWith(7);
  });

  it('does not mark the lead read', async () => {
    const { agent } = await setup();
    await agent.get('/api/leads/7');

    // The workspace polls this endpoint every few seconds. A GET that cleared
    // the flag would clear it on the first tick whether or not anyone read the
    // message, so POST /read is the only way. See AGENT-WORKSPACE.md.
    expect(markLeadRead).not.toHaveBeenCalled();
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    getLeadDetail.mockResolvedValue(null);

    const res = await agent.get('/api/leads/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('rejects a lead id that is not a positive whole number', async () => {
    const { agent } = await setup();
    for (const bad of ['abc', '0', '-1', '1.5']) {
      expect((await agent.get(`/api/leads/${bad}`)).status).toBe(400);
    }
    expect(getLeadDetail).not.toHaveBeenCalled();
  });

  it('passes the flags through as the database reports them', async () => {
    const { agent } = await setup();
    getLeadDetail.mockResolvedValue({
      ...A_LEAD,
      flags: { dnc: true, needsReview: true, unread: true, expired: true },
    });

    const res = await agent.get('/api/leads/7');
    expect(res.body.lead.flags).toEqual({
      dnc: true,
      needsReview: true,
      unread: true,
      expired: true,
    });
  });

  it('reports who is working the lead', async () => {
    const { agent } = await setup();
    getLeadDetail.mockResolvedValue({
      ...A_LEAD,
      claimedBy: { id: 2, name: 'Sam', at: '2026-09-26T10:00:00.000Z' },
    });

    const res = await agent.get('/api/leads/7');
    expect(res.body.lead.claimedBy.name).toBe('Sam');
  });
});
