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
jest.mock('../../integrations/ezt-client', () => ({ toE164: (n: string) => `+${n}` }));

const connect = jest.fn();
jest.mock('../../db/pool', () => ({ pool: { connect: () => connect() } }));

import { webhooksRouter } from '../webhooks';

interface Recorded {
  sql: string;
  values?: unknown[];
}

function fakeClient(opts: { leadId?: number | null; duplicate?: boolean; openConversations?: number }) {
  const calls: Recorded[] = [];
  const client = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      if (/SELECT id FROM leads/i.test(sql)) {
        return opts.leadId ? { rows: [{ id: opts.leadId }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (/INSERT INTO messages/i.test(sql)) {
        return opts.duplicate ? { rows: [], rowCount: 0 } : { rows: [{ id: 7 }], rowCount: 1 };
      }
      if (/UPDATE conversations/i.test(sql)) {
        return { rows: [], rowCount: opts.openConversations ?? 0 };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: jest.fn(),
  };
  return { client, calls };
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

const sqlOf = (calls: Recorded[]) => calls.map((c) => c.sql).join(' || ');

beforeEach(() => {
  fakeConfig.config.ezt.webhookToken = '';
  connect.mockReset();
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
    const { client, calls } = fakeClient({ leadId: 42, openConversations: 1 });
    connect.mockReturnValue(client);

    await request(buildApp()).post('/api/webhooks/eztexting').send(reply({ message: 'STOP' }));

    expect(calls.find((c) => /INSERT INTO dnc_list/i.test(c.sql))?.values).toEqual(['+15551230000', 'sms_stop']);
    expect(sqlOf(calls)).toMatch(/UPDATE conversations SET status = 'suppressed'/i);
  });

  it('rolls back and asks for a retry when the database fails', async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (/SELECT id FROM leads/i.test(sql)) throw new Error('connection lost');
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
