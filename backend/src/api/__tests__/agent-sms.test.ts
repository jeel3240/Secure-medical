/**
 * Agent SMS: sending one, and what happens when the number is blocked or the
 * send fails. The database layer is mocked; the route contract is what is
 * under test. The handoff itself is proved by scripts/agent-sms-live-check.ts,
 * and rule 2b by the state machine's own tests.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { SendAgentSmsResult } from '../../db/agent-sms';

const sendAgentSms = jest.fn<Promise<SendAgentSmsResult>, [number, number, string]>();
jest.mock('../../db/agent-sms', () => ({
  AGENT_SMS_LIMIT: 160,
  sendAgentSms: (...a: [number, number, string]) => sendAgentSms(...a),
}));

const PASSWORD = 'correct-horse-battery';

const A_MESSAGE = {
  id: 1,
  leadId: 7,
  body: 'Hi Jordan, following up on your enquiry.',
  sentBy: 1,
  agentName: 'Maya',
  eztMessageId: '309112289003',
  createdAt: '2026-09-26T10:00:00.000Z',
  tookOver: true,
};

beforeEach(() => {
  sendAgentSms.mockReset();
  sendAgentSms.mockResolvedValue({ ok: true, message: A_MESSAGE });
});

async function setup() {
  const { app, users } = await buildApp();
  await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  const agent = await signIn(app, 'maya@example.com', PASSWORD);
  return { app, agent };
}

describe('sending an agent SMS', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/leads/7/messages').send({ body: 'Hello' });

    expect(res.status).toBe(401);
    expect(sendAgentSms).not.toHaveBeenCalled();
  });

  it('sends it as the caller', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/messages').send({ body: 'Hello' });

    expect(res.status).toBe(201);
    expect(res.body.message).toEqual(A_MESSAGE);
    const [leadId, , body] = sendAgentSms.mock.calls[0];
    expect(leadId).toBe(7);
    expect(body).toBe('Hello');
  });

  it('tells the screen when this send took the conversation over', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/messages').send({ body: 'Hello' });

    // The screen says the automated questions have stopped.
    expect(res.body.message.tookOver).toBe(true);
  });

  it('trims what the agent typed', async () => {
    const { agent } = await setup();
    await agent.post('/api/leads/7/messages').send({ body: '  Hello  ' });

    expect(sendAgentSms.mock.calls[0][2]).toBe('Hello');
  });

  it.each([
    ['missing', {}],
    ['empty', { body: '' }],
    ['only spaces', { body: '   ' }],
    ['not a string', { body: 42 }],
  ])('rejects a body that is %s', async (_label, payload) => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/messages').send(payload);

    expect(res.status).toBe(400);
    expect(sendAgentSms).not.toHaveBeenCalled();
  });

  it('rejects a body longer than one segment', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/messages').send({ body: 'x'.repeat(161) });

    // A second segment is charged on every send.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('body_too_long');
    expect(sendAgentSms).not.toHaveBeenCalled();
  });

  it('accepts a body of exactly one segment', async () => {
    const { agent } = await setup();
    expect((await agent.post('/api/leads/7/messages').send({ body: 'x'.repeat(160) })).status).toBe(201);
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    sendAgentSms.mockResolvedValue({ ok: false, reason: 'lead_not_found' });

    expect((await agent.post('/api/leads/999/messages').send({ body: 'Hello' })).status).toBe(404);
  });

  it('answers 409 when the number is on the do-not-call list', async () => {
    const { agent } = await setup();
    sendAgentSms.mockResolvedValue({ ok: false, reason: 'blocked', phone: '+15550000001' });

    const res = await agent.post('/api/leads/7/messages').send({ body: 'Hello' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('number_blocked');
    expect(res.body.message).toMatch(/nothing was sent/i);
  });

  it('answers 502 when EZ Texting refuses it', async () => {
    const { agent } = await setup();
    sendAgentSms.mockResolvedValue({ ok: false, reason: 'send_failed', detail: 'upstream 500' });

    const res = await agent.post('/api/leads/7/messages').send({ body: 'Hello' });
    // Nothing was written, so the agent can retry the same text.
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('send_failed');
  });
});
