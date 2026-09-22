/**
 * The inbound webhook, with the database mocked. The point of most of these is
 * the account-wide subscription: EZ Texting fires this for every reply to every
 * campaign on the account, so a reply from a phone we hold no lead for belongs
 * to someone else's campaign and must not become a lead here.
 */
import express from 'express';
import request from 'supertest';

const fakeConfig = { config: { ezt: { webhookToken: '' } } };
jest.mock('../../config', () => fakeConfig);
const sendMessage = jest.fn(async () => ({ id: 'sent-1' }));
jest.mock('../../integrations/ezt-client', () => ({
  toE164: (n: string) => `+${n}`,
  sendMessage: (...args: unknown[]) => sendMessage(...(args as [])),
}));

const connect = jest.fn();
// reply-flow reads the message copy and records the send through the pool
// directly, outside the request transaction, so the mock answers both.
const poolQuery = jest.fn(async (sql: string) =>
  /FROM settings/i.test(sql)
    ? { rows: [{ value: 'Question {first_name}?' }], rowCount: 1 }
    : { rows: [], rowCount: 1 }
);
jest.mock('../../db/pool', () => ({
  pool: { connect: () => connect(), query: (...a: unknown[]) => poolQuery(...(a as [string])) },
}));

import { webhooksRouter } from '../webhooks';

interface Recorded {
  sql: string;
  values?: unknown[];
}

/** The seeded scoring rules and tiers, so the flow scores as production does. */
const SCORING_ROWS = [
  { code: 'responded', question: 0, choice: null, points: 10 },
  { code: 'completed', question: 0, choice: null, points: 10 },
  { code: 'q1_1', question: 1, choice: '1', points: 5 },
  { code: 'q1_2', question: 1, choice: '2', points: 10 },
  { code: 'q1_3', question: 1, choice: '3', points: 15 },
  { code: 'q2_1', question: 2, choice: '1', points: 30 },
  { code: 'q3_1', question: 3, choice: '1', points: 35 },
];

const TIER_ROWS = [
  { name: 'HOT', min_score: 75, max_score: 100 },
  { name: 'WARM', min_score: 45, max_score: 74 },
  { name: 'LOW', min_score: 1, max_score: 44 },
];

interface ConversationSeed {
  id?: number;
  status?: string;
  step?: number | null;
  q1?: string | null;
  q2?: string | null;
  q3?: string | null;
  invalid_count?: number;
  score?: number;
  tier?: string | null;
}

function fakeClient(opts: {
  leadId?: number | null;
  duplicate?: boolean;
  /** Omit for a lead with no conversation at all. */
  conversation?: ConversationSeed | null;
}) {
  const calls: Recorded[] = [];
  const conversation =
    opts.conversation === undefined
      ? null
      : opts.conversation === null
        ? null
        : {
            id: 5,
            status: 'open',
            step: 1,
            q1: null,
            q2: null,
            q3: null,
            invalid_count: 0,
            score: 0,
            tier: null,
            ...opts.conversation,
          };

  const client = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });

      if (/SELECT id, first_name FROM leads/i.test(sql)) {
        return opts.leadId
          ? { rows: [{ id: opts.leadId, first_name: 'Jordan' }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (/INSERT INTO messages/i.test(sql)) {
        return opts.duplicate ? { rows: [], rowCount: 0 } : { rows: [{ id: 7 }], rowCount: 1 };
      }
      if (/FROM conversations/i.test(sql)) {
        return conversation ? { rows: [conversation], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (/FROM scoring_rules/i.test(sql)) {
        return { rows: SCORING_ROWS, rowCount: SCORING_ROWS.length };
      }
      if (/FROM tiers/i.test(sql)) {
        return { rows: TIER_ROWS, rowCount: TIER_ROWS.length };
      }
      if (/max_invalid_before_review/.test(sql)) {
        return { rows: [{ value: '1' }], rowCount: 1 };
      }
      if (/expiry_days/.test(sql)) {
        return { rows: [{ value: '7' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: jest.fn(),
  };
  return { client, calls };
}

/** The value written to a column by the UPDATE conversations statement. */
function savedConversation(calls: Recorded[]) {
  const update = calls.find((c) => /UPDATE conversations SET status/i.test(c.sql));
  if (!update?.values) return null;
  const [, status, step, q1, q2, q3, invalidCount, score, tier] = update.values as unknown[];
  return { status, step, q1, q2, q3, invalidCount, score, tier };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', webhooksRouter);
  return app;
}

function reply(over: Record<string, unknown> = {}) {
  return {
    id: '309451030003',
    type: 'inbound_text.received',
    fromNumber: '15551230000',
    toNumber: '15207799209',
    message: '1',
    received: '2026-09-16T10:00:00.000+00:00',
    optIn: false,
    optOut: false,
    ...over,
  };
}

/** The SQL sent through the pool, collapsed so multi-line statements match. */
const poolSql = () => poolQuery.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());

const sqlOf = (calls: Recorded[]) => calls.map((c) => c.sql).join(' || ');

beforeEach(() => {
  fakeConfig.config.ezt.webhookToken = '';
  connect.mockReset();
  poolQuery.mockClear();
  sendMessage.mockClear();
  sendMessage.mockResolvedValue({ id: 'sent-1' });
  poolQuery.mockClear();
});

describe('a reply from a number with no lead', () => {
  it('is ignored: no lead, no conversation, no message', async () => {
    const { client, calls } = fakeClient({ leadId: null });
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply());

    expect(res.status).toBe(200);
    expect(sqlOf(calls)).not.toMatch(/INSERT INTO leads/i);
    expect(sqlOf(calls)).not.toMatch(/INSERT INTO conversations/i);
    expect(sqlOf(calls)).not.toMatch(/INSERT INTO messages/i);
    expect(sqlOf(calls)).toMatch(/COMMIT/);
    expect(client.release).toHaveBeenCalled();
  });

  it.each([
    ['the optOut flag', { optOut: true, message: 'whatever' }],
    ['a plain STOP', { message: 'STOP' }],
    ['lower case and punctuation', { message: ' stop. ' }],
    ['UNSUBSCRIBE', { message: 'unsubscribe' }],
  ])('still blocks the number when it carries %s', async (_label, over) => {
    const { client, calls } = fakeClient({ leadId: null });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply(over));

    const dnc = calls.find((c) => /INSERT INTO dnc_list/i.test(c.sql));
    expect(dnc).toBeDefined();
    expect(dnc?.values).toEqual(['+15551230000', 'sms_stop']);
    expect(sqlOf(calls)).not.toMatch(/INSERT INTO leads/i);
  });

  it('does not block the number for an ordinary reply', async () => {
    const { client, calls } = fakeClient({ leadId: null });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'stop by tomorrow' }));

    expect(sqlOf(calls)).not.toMatch(/INSERT INTO dnc_list/i);
  });
});

describe('a reply from a lead we hold', () => {
  it('is stored and flagged unread', async () => {
    const { client, calls } = fakeClient({ leadId: 42 });
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply());

    expect(res.status).toBe(200);
    const insert = calls.find((c) => /INSERT INTO messages/i.test(c.sql));
    expect(insert?.values).toEqual([42, '1', '309451030003', '15551230000', '2026-09-16T10:00:00.000+00:00']);
    expect(sqlOf(calls)).toMatch(/UPDATE leads SET has_unread_inbound/i);
    expect(sqlOf(calls)).toMatch(/COMMIT/);
  });

  it('ignores a duplicate without flagging it unread again', async () => {
    const { client, calls } = fakeClient({ leadId: 42, duplicate: true });
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply());

    expect(res.status).toBe(200);
    expect(sqlOf(calls)).not.toMatch(/UPDATE leads SET has_unread_inbound/i);
  });

  it('blocks and suppresses on STOP', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'STOP' }));

    expect(calls.find((c) => /INSERT INTO dnc_list/i.test(c.sql))?.values).toEqual([
      '+15551230000',
      'sms_stop',
    ]);
    expect(savedConversation(calls)?.status).toBe('suppressed');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rolls back and asks for a retry when the database fails', async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (/SELECT id, first_name FROM leads/i.test(sql)) throw new Error('connection lost');
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply());

    expect(res.status).toBe(500);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('payloads that are not ours to handle', () => {
  it.each([
    ['another event type', { type: 'contact.created' }],
    ['no fromNumber', { fromNumber: undefined }],
    ['no received', { received: undefined }],
    ['no message', { message: undefined }],
  ])('acknowledges %s without touching the database', async (_label, over) => {
    connect.mockImplementation(() => {
      throw new Error('should not connect');
    });

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply(over));

    expect(res.status).toBe(200);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('the path token', () => {
  it('404s a wrong or missing token once one is configured', async () => {
    fakeConfig.config.ezt.webhookToken = 'the-real-token';
    connect.mockImplementation(() => {
      throw new Error('should not connect');
    });
    const app = buildApp();

    expect((await request(app).post('/api/webhooks/eztexting').send(reply())).status).toBe(404);
    expect((await request(app).post('/api/webhooks/eztexting/nope').send(reply())).status).toBe(404);
    expect(connect).not.toHaveBeenCalled();
  });

  it('accepts the right one', async () => {
    fakeConfig.config.ezt.webhookToken = 'the-real-token';
    const { client } = fakeClient({ leadId: 42 });
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting/the-real-token').send(reply());
    expect(res.status).toBe(200);
  });
});

describe('the reply advances the conversation', () => {
  it('saves a valid answer, scores it, and sends the next question', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '3' }));

    // 10 for responding plus 15 for q1_3.
    expect(savedConversation(calls)).toMatchObject({
      status: 'open',
      step: 2,
      q1: '3',
      score: 25,
      tier: 'LOW',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('completes on the answer to question 3 and sends the thanks', async () => {
    const { client, calls } = fakeClient({
      leadId: 42,
      conversation: { step: 3, q1: '3', q2: '1', score: 55, tier: 'WARM' },
    });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    expect(savedConversation(calls)).toMatchObject({
      status: 'completed',
      q3: '1',
      score: 100,
      tier: 'HOT',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('clarifies an unclear reply without changing the step', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp())
      .post('/api/webhooks/eztexting')
      .send(reply({ message: 'what is this about' }));

    expect(savedConversation(calls)).toMatchObject({ status: 'open', step: 1, invalidCount: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('moves to review once the clarification has been used', async () => {
    const { client, calls } = fakeClient({
      leadId: 42,
      conversation: { invalid_count: 1, score: 10, tier: 'LOW' },
    });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'no idea' }));

    expect(savedConversation(calls)?.status).toBe('review');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('leaves a completed conversation alone and sends nothing', async () => {
    const { client, calls } = fakeClient({
      leadId: 42,
      conversation: { status: 'completed', step: 3, q1: '3', q2: '1', q3: '1', score: 100, tier: 'HOT' },
    });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    expect(savedConversation(calls)).toMatchObject({ status: 'completed', score: 100 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stores the reply but sends nothing when the lead has no conversation', async () => {
    const { client, calls } = fakeClient({ leadId: 42 });
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply());

    expect(res.status).toBe(200);
    expect(sqlOf(calls)).toMatch(/INSERT INTO messages/i);
    expect(sqlOf(calls)).not.toMatch(/UPDATE conversations SET status/i);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends only after the transaction commits', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);
    let committedBeforeSend = false;
    sendMessage.mockImplementation(async () => {
      committedBeforeSend = calls.some((c) => c.sql === 'COMMIT');
      return { id: 'sent-1' };
    });

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '3' }));

    // An answer the lead has given must not be rolled back by a failed send.
    expect(committedBeforeSend).toBe(true);
  });

  it('restarts the reply window only after the send succeeds', async () => {
    const { client } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '3' }));

    const bump = poolSql().find((sql) => /UPDATE conversations SET expires_at/i.test(sql));
    expect(bump).toBeDefined();
    // Only while the lead still owes us an answer.
    expect(bump).toMatch(/status = 'open'/);
  });

  it('leaves the reply window alone when the send fails', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);
    sendMessage.mockRejectedValue(new Error('EZ Texting down'));

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '3' }));

    // A lead who was never actually messaged should expire on schedule, not a
    // week later. The conversation still advances.
    expect(poolSql().some((sql) => /expires_at/i.test(sql))).toBe(false);
    expect(sqlOf(calls)).not.toMatch(/expires_at/i);
    expect(savedConversation(calls)).toMatchObject({ step: 2, q1: '3' });
  });

  it('keeps the advanced conversation when the send fails', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);
    sendMessage.mockRejectedValue(new Error('EZ Texting down'));

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '3' }));

    // 200, not 500: retrying would not re-send, and the answer is saved.
    expect(res.status).toBe(200);
    expect(savedConversation(calls)).toMatchObject({ step: 2, q1: '3' });
    expect(sqlOf(calls)).toMatch(/COMMIT/);
  });
});
