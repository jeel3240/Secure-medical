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

import { ANTIBIOTICS, Q1, Q2 } from '../../core/flow-fixtures';
import { webhooksRouter } from '../webhooks';

interface Recorded {
  sql: string;
  values?: unknown[];
}

/**
 * The antibiotics flow as the database would return it, so the webhook walks
 * the real script - docs/FLOWS.md. Built from the same fixture the state
 * machine's own tests use.
 */
const FLOW_ROW = {
  id: ANTIBIOTICS.id,
  key: ANTIBIOTICS.key,
  responded_points: ANTIBIOTICS.respondedPoints,
  completed_points: ANTIBIOTICS.completedPoints,
  review_body: ANTIBIOTICS.reviewBody,
};
const QUESTION_ROWS = ANTIBIOTICS.questions.map((q) => ({
  id: q.id,
  key: q.key,
  position: q.position,
  body: q.body,
  clarify_body: q.clarifyBody,
  heading: q.heading,
}));
const CHOICE_ROWS = ANTIBIOTICS.questions.flatMap((q) =>
  q.choices.map((c) => ({
    question_id: q.id,
    choice: c.choice,
    label: c.label,
    words: c.words,
    points: c.points,
    reply_body: c.reply,
    next_question_id: c.nextQuestionId,
    ending: c.ending,
  }))
);

const TIER_ROWS = [
  { name: 'HOT', min_score: 75, max_score: 100 },
  { name: 'WARM', min_score: 45, max_score: 74 },
  { name: 'LOW', min_score: 1, max_score: 44 },
];

interface ConversationSeed {
  id?: number;
  status?: string;
  step?: number | null;
  /** The question the lead is on. Follows `step` when not given. */
  current_question_id?: number | null;
  end_outcome?: string | null;
  invalid_count?: number;
  score?: number;
  tier?: string | null;
  agent_took_over_at?: string | null;
  /** Whether the text the lead has to answer has gone out. Yes, unless a test says otherwise. */
  question_sent?: boolean;
  /** It has not, and not just now. */
  unsent_for_long?: boolean;
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
            flow_id: ANTIBIOTICS.id,
            step: 10,
            invalid_count: 0,
            score: 0,
            tier: null,
            end_outcome: null,
            question_sent: true,
            unsent_for_long: false,
            // On the question its step names, unless the conversation is over.
            current_question_id:
              (opts.conversation.status ?? 'open') === 'open'
                ? (ANTIBIOTICS.questions.find((q) => q.position === (opts.conversation?.step ?? 10))?.id ?? Q1)
                : null,
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
      if (/FROM flow_choices/i.test(sql)) {
        return { rows: CHOICE_ROWS, rowCount: CHOICE_ROWS.length };
      }
      if (/FROM flow_questions/i.test(sql)) {
        return { rows: QUESTION_ROWS, rowCount: QUESTION_ROWS.length };
      }
      if (/FROM flows/i.test(sql)) {
        return { rows: [FLOW_ROW], rowCount: 1 };
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
  const [, status, step, currentQuestionId, invalidCount, score, tier, endOutcome, textOwed] = update.values as unknown[];
  return { status, step, currentQuestionId, invalidCount, score, tier, endOutcome, textOwed };
}

/** The answer row written, if any: [conversation, lead, question, key, position, heading, choice, label, points]. */
function savedAnswer(calls: Recorded[]) {
  const insert = calls.find((c) => /INSERT INTO conversation_answers/i.test(c.sql));
  if (!insert?.values) return null;
  const [conversationId, leadId, questionId, questionKey, , , choice, label, points, messageId] = insert.values as unknown[];
  return { conversationId, leadId, questionId, questionKey, choice, label, points, messageId };
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

/** The text of the first SMS sent. */
const sentText = () => String((sendMessage.mock.calls[0] as unknown[] | undefined)?.[1] ?? '');

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

describe('the raw archive - AUDIT.md', () => {
  const archived = () => poolQuery.mock.calls.filter(([sql]) => /INSERT INTO webhook_events/i.test(String(sql)));

  it('keeps every request as it arrived, even one we go on to ignore', async () => {
    const odd = { type: 'something.else', fromNumber: '15551230000' };
    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(odd);

    expect(res.status).toBe(200);
    expect(archived()).toHaveLength(1);
    const [, values] = archived()[0] as unknown as [string, unknown[]];
    // The path is stored without the secret segment.
    expect(values).toEqual(['eztexting', '/api/webhooks/eztexting', JSON.stringify(odd)]);
  });

  it('keeps nothing from a request with the wrong token', async () => {
    fakeConfig.config.ezt.webhookToken = 'the-real-token';
    const res = await request(buildApp()).post('/api/webhooks/eztexting/a-guess').send(reply());
    expect(res.status).toBe(404);
    expect(archived()).toHaveLength(0);
  });
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
    // The third value is who did it: nobody, for a STOP - the lead's own doing.
    expect(dnc?.values).toEqual(['+15551230000', 'sms_stop', null]);
    // And the block records itself in the activity log, in the same statement.
    expect(dnc?.sql).toMatch(/INSERT INTO activity_log[\s\S]*'dnc\.blocked'/);
    expect(sqlOf(calls)).not.toMatch(/INSERT INTO leads/i);
  });

  it('does not block the number for an ordinary reply', async () => {
    const { client, calls } = fakeClient({ leadId: null });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'stop by tomorrow' }));

    expect(sqlOf(calls)).not.toMatch(/INSERT INTO dnc_list/i);
  });
});

describe('START, a lead asking to hear from us again', () => {
  it('releases the block and keeps the row as the record', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: { status: 'suppressed' } });
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'START' }));

    expect(res.status).toBe(200);
    const release = calls.find((c) => /UPDATE dnc_list/i.test(c.sql));
    expect(release?.sql).toMatch(/released_at = now\(\)/);
    // Only live blocks, and the row is never deleted.
    expect(release?.sql).toMatch(/released_at IS NULL/);
    expect(release?.values).toEqual(['+15551230000', 'sms_start', null]);
    expect(release?.sql).toMatch(/INSERT INTO activity_log[\s\S]*'dnc\.released'/);
    expect(sqlOf(calls)).not.toMatch(/DELETE FROM dnc_list/i);
  });

  it.each([['start'], [' Start. '], ['UNSTOP'], ['yes']])('accepts %j', async (message) => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: { status: 'suppressed' } });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message }));

    expect(calls.some((c) => /UPDATE dnc_list/i.test(c.sql))).toBe(true);
  });

  it('leaves the suppressed conversation closed and sends nothing', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: { status: 'suppressed' } });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'START' }));

    // Stored and flagged, so an agent sees they came back.
    expect(sqlOf(calls)).toMatch(/INSERT INTO messages/i);
    expect(sqlOf(calls)).toMatch(/UPDATE leads SET has_unread_inbound/i);
    expect(savedConversation(calls)).toMatchObject({ status: 'suppressed' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('releases a block for a number we hold no lead for, without creating one', async () => {
    const { client, calls } = fakeClient({ leadId: null });
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'START' }));

    expect(res.status).toBe(200);
    expect(calls.some((c) => /UPDATE dnc_list/i.test(c.sql))).toBe(true);
    expect(sqlOf(calls)).not.toMatch(/INSERT INTO leads/i);
    expect(sqlOf(calls)).not.toMatch(/INSERT INTO messages/i);
  });

  it('is not triggered by STOP, nor by a sentence containing start', async () => {
    for (const message of ['STOP', 'start the process please']) {
      const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message }));

      expect(calls.some((c) => /UPDATE dnc_list/i.test(c.sql))).toBe(false);
    }
  });

  it('blocks again if they opt out after opting back in', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'STOP' }));

    const block = calls.find((c) => /INSERT INTO dnc_list/i.test(c.sql));
    // The same row comes back to life rather than a second one being written.
    expect(block?.sql).toMatch(/ON CONFLICT \(phone\) DO UPDATE/i);
    expect(block?.sql).toMatch(/released_at = NULL/i);
  });
});

describe('a reply from a lead we hold', () => {
  it('is stored, and flagged for a person when it has no conversation to handle it', async () => {
    const { client, calls } = fakeClient({ leadId: 42 });
    connect.mockReturnValue(client);

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply());

    expect(res.status).toBe(200);
    const insert = calls.find((c) => /INSERT INTO messages/i.test(c.sql));
    expect(insert?.values).toEqual([42, '1', '309451030003', '15551230000', '2026-09-16T10:00:00.000+00:00']);
    expect(sqlOf(calls)).toMatch(/UPDATE leads SET has_unread_inbound/i);
    expect(sqlOf(calls)).toMatch(/COMMIT/);
  });

  describe('flagging a reply for a person', () => {
    // The flag is the queue's Inbound reply. It is set only for a reply the
    // questions do not handle - never for an answer - Jeel, 2026-09-28.
    const flagged = (calls: Recorded[]) => /UPDATE leads SET has_unread_inbound/i.test(sqlOf(calls));

    it('does not flag an answer to the question in progress', async () => {
      const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

      expect(flagged(calls)).toBe(false);
    });

    it('does not flag the answer that completes the conversation', async () => {
      const conversation = { step: 30, score: 45, tier: 'WARM' };
      const { client, calls } = fakeClient({ leadId: 42, conversation });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

      expect(flagged(calls)).toBe(false);
    });

    it('flags a message after the conversation ended', async () => {
      const { client, calls } = fakeClient({ leadId: 42, conversation: { status: 'completed', score: 100 } });
      connect.mockReturnValue(client);

      await request(buildApp())
        .post('/api/webhooks/eztexting')
        .send(reply({ message: 'can you call me at 3?' }));

      expect(flagged(calls)).toBe(true);
    });

    it('flags a reply to an agent who took the conversation over', async () => {
      const conversation = { step: 20, score: 30, agent_took_over_at: '2026-09-28T10:00:00.000Z' };
      const { client, calls } = fakeClient({ leadId: 42, conversation });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

      expect(flagged(calls)).toBe(true);
    });

    it('does not flag an opt-out', async () => {
      const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'STOP' }));

      expect(flagged(calls)).toBe(false);
    });
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
      null,
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

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    // 10 for responding plus 20 for Yes.
    expect(savedConversation(calls)).toMatchObject({
      status: 'open',
      step: 20,
      currentQuestionId: Q2,
      score: 30,
      tier: 'LOW',
    });
    // The answer is its own row, with the word and the points as they are now.
    expect(savedAnswer(calls)).toEqual({
      conversationId: 5,
      leadId: 42,
      questionId: Q1,
      questionKey: 'q1',
      choice: '1',
      label: 'Yes',
      points: 20,
      // The stored text it was read from, so the thread can label that very message.
      messageId: 7,
    });
    // The reply and the next question, as one text.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sentText()).toBe(
      "Great! Let's get you started. Have you used telemedicine to get prescription medication before? Reply 1. Yes, 2. No."
    );
  });

  it('"No" on the first question goes to the offers question, not the second', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'no' }));

    expect(savedConversation(calls)).toMatchObject({ status: 'open', step: 11, score: 10 });
    expect(sentText()).toMatch(/^No problem\. Would you like to receive special offers from eDrugstore\?/);
  });

  it('completes on the answer to question 3 and sends that answer\'s message', async () => {
    const { client, calls } = fakeClient({
      leadId: 42,
      conversation: { step: 30, score: 45, tier: 'WARM' },
    });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '2' }));

    // 45 so far, 45 for "Talk to an agent", 10 for finishing.
    expect(savedConversation(calls)).toMatchObject({
      status: 'completed',
      currentQuestionId: null,
      endOutcome: 'completed',
      score: 100,
      tier: 'HOT',
    });
    expect(savedAnswer(calls)).toMatchObject({ questionKey: 'q3', label: 'Talk to an agent', points: 45 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('clarifies an unclear reply without changing the step', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp())
      .post('/api/webhooks/eztexting')
      .send(reply({ message: 'what is this about' }));

    expect(savedConversation(calls)).toMatchObject({ status: 'open', step: 10, invalidCount: 1 });
    expect(savedAnswer(calls)).toBeNull();
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
      conversation: { status: 'completed', step: 30, score: 100, tier: 'HOT', end_outcome: 'completed' },
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

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    // An answer the lead has given must not be rolled back by a failed send.
    expect(committedBeforeSend).toBe(true);
  });

  it('locks the conversation while it works, so two replies at once cannot clash', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    const read = calls.find((c) => /SELECT .* FROM conversations/i.test(c.sql));
    expect(read?.sql).toMatch(/FOR UPDATE/i);
    // Inside the transaction, or the lock would be released immediately.
    const order = calls.map((c) => c.sql);
    expect(order.indexOf('BEGIN')).toBeLessThan(order.findIndex((s) => /FOR UPDATE/i.test(s)));
  });

  it('restarts the reply window only after the send succeeds', async () => {
    const { client } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    const bump = poolSql().find((sql) => /UPDATE conversations SET expires_at/i.test(sql));
    expect(bump).toBeDefined();
    // Only while the lead still owes us an answer.
    expect(bump).toMatch(/status = 'open'/);
  });

  it('leaves the reply window alone when the send fails', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);
    sendMessage.mockRejectedValue(new Error('EZ Texting down'));

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    // A lead who was never actually messaged should expire on schedule, not a
    // week later. The conversation still advances.
    expect(poolSql().some((sql) => /expires_at/i.test(sql))).toBe(false);
    expect(sqlOf(calls)).not.toMatch(/expires_at/i);
    expect(savedConversation(calls)).toMatchObject({ step: 20, currentQuestionId: Q2 });
  });

  it('flags a lead whose text did not go out, so a person sees them', async () => {
    const { client } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);
    sendMessage.mockRejectedValue(new Error('EZ Texting down'));

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    // They answered and heard nothing back; nothing retries a question, and a
    // lead partway through is not in the queue. The flag is what puts them there.
    expect(poolSql().some((sql) => /UPDATE leads SET has_unread_inbound = true/i.test(sql))).toBe(true);
  });

  it('does not flag one whose number is blocked: that text was never owed', async () => {
    const { client } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);
    sendMessage.mockRejectedValue(Object.assign(new Error('blocked'), { name: 'BlockedNumberError' }));

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    expect(poolSql().some((sql) => /has_unread_inbound/i.test(sql))).toBe(false);
  });

  it('hands its connection back before it sends', async () => {
    const { client } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);
    let releasedBeforeSend: boolean | null = null;
    sendMessage.mockImplementation(async () => {
      releasedBeforeSend = client.release.mock.calls.length > 0;
      return { id: 'sent-1' };
    });

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    // Held across the send, ten replies at once each kept one connection and
    // waited for another to record their text, and the API stopped.
    expect(releasedBeforeSend).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('a STOP sends nothing', async () => {
    const { client } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'STOP' }));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  describe('a reply before our text has gone out', () => {
    // "Yes", and a second later "yes" again: the second arrives while question
    // 2 is still on its way, and used to be saved as the answer to it.
    const unsent = { step: 20, score: 30, tier: 'LOW', question_sent: false };

    it('is not an answer: nothing is saved, scored or sent', async () => {
      const { client, calls } = fakeClient({ leadId: 42, conversation: unsent });
      connect.mockReturnValue(client);

      const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'yes' }));

      expect(res.status).toBe(200);
      expect(savedConversation(calls)).toBeNull();
      expect(savedAnswer(calls)).toBeNull();
      expect(sendMessage).not.toHaveBeenCalled();
      // Kept in the thread all the same.
      expect(sqlOf(calls)).toMatch(/INSERT INTO messages/i);
      // A double tap is not something for a person to read.
      expect(sqlOf(calls)).not.toMatch(/has_unread_inbound/i);
    });

    it('goes to a person when our text has been unsent for a while: it is not on its way', async () => {
      const { client, calls } = fakeClient({ leadId: 42, conversation: { ...unsent, unsent_for_long: true } });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'yes' }));

      expect(savedAnswer(calls)).toBeNull();
      expect(sendMessage).not.toHaveBeenCalled();
      expect(sqlOf(calls)).toMatch(/UPDATE leads SET has_unread_inbound = true/i);
    });

    it('never holds up a STOP', async () => {
      const { client, calls } = fakeClient({ leadId: 42, conversation: unsent });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'STOP' }));

      expect(savedConversation(calls)).toMatchObject({ status: 'suppressed' });
      expect(sqlOf(calls)).toMatch(/INSERT INTO dnc_list/i);
    });

    it('a reply that earns a text marks it as owed, and the send marks it as gone', async () => {
      const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

      // Saved as waiting on our text: the next reply does not count until it has gone.
      expect(savedConversation(calls)).toMatchObject({ currentQuestionId: Q2, textOwed: true });
      const save = calls.find((c) => /UPDATE conversations SET status/i.test(c.sql));
      expect(save?.sql).toMatch(/question_sent_at = CASE WHEN \$9 THEN NULL ELSE question_sent_at END/);
      // And once it has, the conversation says so.
      expect(poolSql().find((sql) => /UPDATE conversations SET expires_at/i.test(sql))).toMatch(/question_sent_at = now\(\)/);
    });

    it('a reply that ends the questions owes nothing more', async () => {
      const { client, calls } = fakeClient({ leadId: 42, conversation: { step: 30, score: 45, tier: 'WARM' } });
      connect.mockReturnValue(client);

      await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '2' }));

      expect(savedConversation(calls)).toMatchObject({ status: 'completed', textOwed: false });
    });
  });

  it('keeps the advanced conversation when the send fails', async () => {
    const { client, calls } = fakeClient({ leadId: 42, conversation: {} });
    connect.mockReturnValue(client);
    sendMessage.mockRejectedValue(new Error('EZ Texting down'));

    const res = await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: '1' }));

    // 200, not 500: retrying would not re-send, and the answer is saved.
    expect(res.status).toBe(200);
    expect(savedConversation(calls)).toMatchObject({ step: 20, currentQuestionId: Q2 });
    expect(sqlOf(calls)).toMatch(/COMMIT/);
  });
});
