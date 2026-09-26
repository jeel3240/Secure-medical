/**
 * Setting a disposition, and the confirmation the DNC one requires.
 * The database layer is mocked; the route contract is what is under test.
 * The transaction and the block itself are proved by
 * scripts/dispositions-live-check.ts.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { SetDispositionResult } from '../../db/dispositions';

const setDisposition = jest.fn<Promise<SetDispositionResult>, [number, number, any]>();
jest.mock('../../db/dispositions', () => ({
  setDisposition: (...a: [number, number, any]) => setDisposition(...a),
}));

const PASSWORD = 'correct-horse-battery';

const A_DISPOSITION = {
  id: 1,
  leadId: 7,
  agentId: 1,
  agentName: 'Maya',
  value: 'interested' as const,
  createdAt: '2026-09-26T10:00:00.000Z',
  blockedNumber: false,
};

beforeEach(() => {
  setDisposition.mockReset();
  setDisposition.mockResolvedValue({ ok: true, disposition: A_DISPOSITION });
});

async function setup() {
  const { app, users } = await buildApp();
  await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  const agent = await signIn(app, 'maya@example.com', PASSWORD);
  return { app, agent };
}

describe('setting a disposition', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/leads/7/dispositions').send({ value: 'interested' });

    expect(res.status).toBe(401);
    expect(setDisposition).not.toHaveBeenCalled();
  });

  it('records it against the caller', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/dispositions').send({ value: 'interested' });

    expect(res.status).toBe(201);
    expect(res.body.disposition).toEqual(A_DISPOSITION);
    const [leadId, , value] = setDisposition.mock.calls[0];
    expect(leadId).toBe(7);
    expect(value).toBe('interested');
  });

  it.each([
    'interested',
    'callback_set',
    'no_answer',
    'voicemail',
    'not_interested',
    'wrong_number',
  ])('accepts %s without a confirmation', async (value) => {
    const { agent } = await setup();
    expect((await agent.post('/api/leads/7/dispositions').send({ value })).status).toBe(201);
  });

  it('accepts a value in any case, with padding', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/dispositions').send({ value: '  No_Answer ' });

    expect(res.status).toBe(201);
    expect(setDisposition.mock.calls[0][2]).toBe('no_answer');
  });

  it.each([
    ['missing', {}],
    ['empty', { value: '' }],
    ['not in the seven', { value: 'maybe_later' }],
    ['not a string', { value: 3 }],
  ])('rejects a value that is %s', async (_label, payload) => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/dispositions').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_disposition');
    expect(setDisposition).not.toHaveBeenCalled();
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    setDisposition.mockResolvedValue({ ok: false, reason: 'lead_not_found' });

    expect((await agent.post('/api/leads/999/dispositions').send({ value: 'voicemail' })).status).toBe(404);
  });

  it('is append-only: the same value twice is two rows, not an error', async () => {
    const { agent } = await setup();

    expect((await agent.post('/api/leads/7/dispositions').send({ value: 'no_answer' })).status).toBe(201);
    expect((await agent.post('/api/leads/7/dispositions').send({ value: 'no_answer' })).status).toBe(201);
    expect(setDisposition).toHaveBeenCalledTimes(2);
  });
});

describe('the DNC disposition', () => {
  it('is refused without an explicit confirmation', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/dispositions').send({ value: 'dnc' });

    // A mis-click must not block a number that only a START can unblock.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('confirm_required');
    expect(setDisposition).not.toHaveBeenCalled();
  });

  it.each([
    ['false', false],
    ['a truthy string', 'yes'],
    ['1', 1],
  ])('is refused when confirmDnc is %s', async (_label, confirmDnc) => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/dispositions').send({ value: 'dnc', confirmDnc });

    expect(res.status).toBe(400);
    expect(setDisposition).not.toHaveBeenCalled();
  });

  it('goes through when confirmed', async () => {
    const { agent } = await setup();
    setDisposition.mockResolvedValue({
      ok: true,
      disposition: { ...A_DISPOSITION, value: 'dnc', blockedNumber: true },
    });

    const res = await agent.post('/api/leads/7/dispositions').send({ value: 'dnc', confirmDnc: true });

    expect(res.status).toBe(201);
    // The screen shows a different confirmation when the number was blocked.
    expect(res.body.disposition.blockedNumber).toBe(true);
  });

  it('needs no confirmation for the other six', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/dispositions').send({ value: 'not_interested' });

    expect(res.status).toBe(201);
  });
});
