/**
 * Claiming and releasing a lead. The database layer is mocked; what is under
 * test here is the route contract - who may do what, and which status code
 * each outcome produces.
 *
 * The concurrency rule itself lives in the SQL and is proved against a real
 * database by scripts/claims-live-check.ts.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { ClaimResult, ReleaseResult } from '../../db/claims';

const claimLead = jest.fn<Promise<ClaimResult>, [number, number]>();
const releaseLead = jest.fn<Promise<ReleaseResult>, [number, number, boolean]>();
jest.mock('../../db/claims', () => ({
  claimLead: (...a: [number, number]) => claimLead(...a),
  releaseLead: (...a: [number, number, boolean]) => releaseLead(...a),
}));

const PASSWORD = 'correct-horse-battery';

const A_CLAIM = {
  leadId: 7,
  agentId: 1,
  agentName: 'Maya',
  claimedAt: '2026-09-26T10:00:00.000Z',
};

beforeEach(() => {
  claimLead.mockReset();
  releaseLead.mockReset();
  claimLead.mockResolvedValue({ ok: true, claim: A_CLAIM });
  releaseLead.mockResolvedValue({ ok: true });
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

describe('claiming a lead', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/leads/7/claim');
    expect(res.status).toBe(401);
    expect(claimLead).not.toHaveBeenCalled();
  });

  it('claims it for the signed-in agent', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/claim');

    expect(res.status).toBe(200);
    expect(res.body.claim).toEqual(A_CLAIM);
    // The agent id comes from the session, never the request.
    expect(claimLead).toHaveBeenCalledWith(7, expect.any(Number));
  });

  it('answers 409 with the holder name when someone else has it', async () => {
    const { agent } = await setup();
    claimLead.mockResolvedValue({
      ok: false,
      reason: 'already_claimed',
      heldBy: { id: 2, name: 'Sam' },
    });

    const res = await agent.post('/api/leads/7/claim');

    // 409, not 403: the caller did nothing wrong, someone was simply first.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_claimed');
    expect(res.body.message).toContain('Sam');
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    claimLead.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await agent.post('/api/leads/999/claim');
    expect(res.status).toBe(404);
  });

  it('rejects a lead id that is not a positive whole number', async () => {
    const { agent } = await setup();
    for (const bad of ['abc', '0', '-1', '1.5']) {
      const res = await agent.post(`/api/leads/${bad}/claim`);
      expect(res.status).toBe(400);
    }
    expect(claimLead).not.toHaveBeenCalled();
  });
});

describe('releasing a lead', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/leads/7/release');
    expect(res.status).toBe(401);
    expect(releaseLead).not.toHaveBeenCalled();
  });

  it('releases your own claim', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/release');

    expect(res.status).toBe(204);
    // Not a superadmin, so the database layer must enforce ownership.
    expect(releaseLead).toHaveBeenCalledWith(7, expect.any(Number), false);
  });

  it('lets a superadmin force a release', async () => {
    const { boss } = await setup();
    const res = await boss.post('/api/leads/7/release');

    expect(res.status).toBe(204);
    expect(releaseLead).toHaveBeenCalledWith(7, expect.any(Number), true);
  });

  it("refuses when an agent tries to release someone else's claim", async () => {
    const { agent } = await setup();
    releaseLead.mockResolvedValue({
      ok: false,
      reason: 'not_yours',
      heldBy: { id: 2, name: 'Sam' },
    });

    const res = await agent.post('/api/leads/7/release');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_yours');
    expect(res.body.message).toContain('Sam');
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    releaseLead.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await agent.post('/api/leads/999/release');
    expect(res.status).toBe(404);
  });
});
