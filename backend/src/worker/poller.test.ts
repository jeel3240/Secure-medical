/**
 * The poller's decision per contact, with EZ Texting and the database mocked.
 *
 * The point of most of these is who must never be texted: a contact EZ Texting
 * has already marked opted out, and a phone on our own dnc_list. Both are saved
 * as leads so the arrival is visible, both get a suppressed conversation, and
 * neither gets a message.
 */

const fakeConfig = {
  config: { ezt: { group: 'weightloss', source: 'WebInterface', sendGroup: 'weightloss' } },
};
jest.mock('../config', () => fakeConfig);

const listContacts = jest.fn();
const sendMessage = jest.fn(async () => ({ id: 'sent-1' }));
jest.mock('../integrations/ezt-client', () => ({
  listContacts: (...a: unknown[]) => listContacts(...(a as [])),
  sendMessage: (...a: unknown[]) => sendMessage(...(a as [])),
  toE164: (n: string) => `+${n}`,
  isInGroup: (c: { groups?: { name: string }[] }, name: string) =>
    (c.groups ?? []).some((g) => g.name === name),
  findGroup: (c: { groups?: { id: string; name: string }[] }, name: string) =>
    (c.groups ?? []).find((g) => g.name === name),
}));

interface Recorded {
  sql: string;
  values?: unknown[];
}

const recorded: Recorded[] = [];
let leadInsertReturns: { rows: unknown[]; rowCount: number };
let dncRows: { rows: unknown[]; rowCount: number };

function answer(sql: string) {
  if (/FROM settings WHERE key = \$1/i.test(sql)) {
    return { rows: [{ value: 'Hi {first_name}, reply 1. A, 2. B, 3. C' }], rowCount: 1 };
  }
  if (/FROM dnc_list/i.test(sql)) return dncRows;
  if (/INSERT INTO leads/i.test(sql)) return leadInsertReturns;
  return { rows: [], rowCount: 1 };
}

const query = jest.fn(async (sql: string, values?: unknown[]) => {
  recorded.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
  return answer(sql);
});

jest.mock('../db/pool', () => ({
  pool: {
    query: (...a: unknown[]) => query(...(a as [string, unknown[]])),
    connect: async () => ({ query: (...a: unknown[]) => query(...(a as [string, unknown[]])), release: () => undefined }),
  },
}));

import { pollOnce } from './poller';

function contact(over: Record<string, unknown> = {}) {
  return {
    phoneNumber: '15551230000',
    firstName: 'Ada',
    lastName: 'L',
    email: null,
    source: 'WebInterface',
    createdAt: new Date().toISOString(),
    optOut: false,
    groups: [{ id: '1', name: 'weightloss' }],
    ...over,
  };
}

const sqlOf = () => recorded.map((r) => r.sql).join(' || ');
const conversationInsert = () => recorded.find((r) => /INSERT INTO conversations/i.test(r.sql));

beforeEach(() => {
  recorded.length = 0;
  query.mockClear();
  sendMessage.mockClear();
  sendMessage.mockResolvedValue({ id: 'sent-1' });
  leadInsertReturns = { rows: [{ id: 42 }], rowCount: 1 };
  dncRows = { rows: [], rowCount: 0 };
  listContacts.mockResolvedValue({ content: [contact()], last: true });
});

describe('a contact EZ Texting has marked opted out', () => {
  it('is saved suppressed, blocked, and never texted', async () => {
    listContacts.mockResolvedValue({ content: [contact({ optOut: true })], last: true });

    const stats = await pollOnce();

    expect(stats).toMatchObject({ fetched: 1, inserted: 0, suppressed: 1, openersSent: 0 });
    expect(conversationInsert()?.values).toEqual([42, 'suppressed', null]);
    expect(sqlOf()).toMatch(/INSERT INTO dnc_list/i);
    expect(recorded.find((r) => /INSERT INTO dnc_list/i.test(r.sql))?.sql).toMatch(/ezt_opt_out/);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('a phone already on our do-not-call list', () => {
  it('is saved suppressed and never texted', async () => {
    dncRows = { rows: [{ '?column?': 1 }], rowCount: 1 };

    const stats = await pollOnce();

    expect(stats).toMatchObject({ suppressed: 1, inserted: 0, openersSent: 0 });
    expect(conversationInsert()?.values).toEqual([42, 'suppressed', null]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('only counts live blocks, not released ones', async () => {
    await pollOnce();
    const check = recorded.find((r) => /FROM dnc_list/i.test(r.sql));
    expect(check?.sql).toMatch(/released_at IS NULL/i);
  });
});

describe('an ordinary new contact', () => {
  it('is saved open at step 1 and gets the opener', async () => {
    const stats = await pollOnce();

    expect(stats).toMatchObject({ fetched: 1, inserted: 1, suppressed: 0, openersSent: 1 });
    expect(conversationInsert()?.values).toEqual([42, 'open', 1]);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sqlOf()).toMatch(/INSERT INTO messages/i);
    // The reply window starts when the opener goes out.
    expect(sqlOf()).toMatch(/SET expires_at = now\(\)/i);
  });

  it('is skipped when the phone is already a lead', async () => {
    leadInsertReturns = { rows: [], rowCount: 0 };

    const stats = await pollOnce();

    expect(stats).toMatchObject({ inserted: 0, skipped: 1, suppressed: 0, openersSent: 0 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('is skipped when it is not really in the group', async () => {
    listContacts.mockResolvedValue({
      content: [contact({ groups: [{ id: '2', name: 'weightloss - sent' }] })],
      last: true,
    });

    const stats = await pollOnce();

    expect(stats).toMatchObject({ skipped: 1, inserted: 0 });
    expect(sqlOf()).not.toMatch(/INSERT INTO leads/i);
  });
});

describe('when the opener cannot be sent', () => {
  it('keeps the lead, counts it, and leaves the reply window unset', async () => {
    sendMessage.mockRejectedValue(new Error('EZ Texting down'));

    const stats = await pollOnce();

    expect(stats).toMatchObject({ inserted: 1, openersSent: 0 });
    expect(sqlOf()).not.toMatch(/SET expires_at = now\(\)/i);
  });
});

describe('the checkpoint', () => {
  it('is not advanced when the fetch fails, so nothing is skipped next tick', async () => {
    listContacts.mockRejectedValue(new Error('EZ Texting down'));

    await expect(pollOnce()).rejects.toThrow('EZ Texting down');
    expect(sqlOf()).not.toMatch(/INSERT INTO settings/i);
  });
});
