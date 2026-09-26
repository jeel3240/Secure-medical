/**
 * Marking a lead read. The database layer is mocked; the route contract is
 * what is under test. The SQL is proved by scripts/read-flag-live-check.ts.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { MarkReadResult } from '../../db/read-flag';

const markLeadRead = jest.fn<Promise<MarkReadResult>, [number]>();
jest.mock('../../db/read-flag', () => ({ markLeadRead: (id: number) => markLeadRead(id) }));

const PASSWORD = 'correct-horse-battery';

beforeEach(() => {
  markLeadRead.mockReset();
  markLeadRead.mockResolvedValue({ ok: true, changed: true });
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

describe('marking a lead read', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/leads/7/read');
    expect(res.status).toBe(401);
    expect(markLeadRead).not.toHaveBeenCalled();
  });

  it('clears the flag for an agent', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/read');

    expect(res.status).toBe(204);
    expect(markLeadRead).toHaveBeenCalledWith(7);
  });

  it('lets a superadmin mark one read too', async () => {
    const { boss } = await setup();
    // Reading is not claiming: a superadmin looking at a lead an agent holds
    // has still read it.
    const res = await boss.post('/api/leads/7/read');
    expect(res.status).toBe(204);
  });

  it('succeeds when the lead was already read', async () => {
    const { agent } = await setup();
    markLeadRead.mockResolvedValue({ ok: true, changed: false });

    // Idempotent: the caller wanted it read, and it is.
    const res = await agent.post('/api/leads/7/read');
    expect(res.status).toBe(204);
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    markLeadRead.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await agent.post('/api/leads/999/read');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('rejects a lead id that is not a positive whole number', async () => {
    const { agent } = await setup();
    for (const bad of ['abc', '0', '-1', '1.5']) {
      expect((await agent.post(`/api/leads/${bad}/read`)).status).toBe(400);
    }
    expect(markLeadRead).not.toHaveBeenCalled();
  });
});
