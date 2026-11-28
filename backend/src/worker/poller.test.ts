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
/** What `settings` holds for the poller's own two keys - null: no row (review Q6: one answer for every key hid them). */
let checkpointValue: string | null;
let overlapValue: string | null;
/** Phones whose lead insert, or whose do-not-call check, throws - B06. */
let insertFails: Set<string>;
let dncFails: Set<string>;
/** Non-null: the leads table as a set of phones, so a second poll skips what the first took in. */
let known: Set<string> | null;
/** The buckets table as `onlyBucket` reads it: the first bucket's id, and how many there are (B08). */
let bucketRow: { id: number; buckets: number };

function answer(sql: string, values?: unknown[]) {
  if (/FROM buckets/i.test(sql)) return { rows: [bucketRow], rowCount: 1 };
  if (/FROM settings WHERE key = \$1/i.test(sql)) {
    const key = values?.[0];
    if (key === 'ezt_poll_checkpoint' || key === 'poll_overlap_minutes') {
      const value = key === 'ezt_poll_checkpoint' ? checkpointValue : overlapValue;
      return value === null ? { rows: [], rowCount: 0 } : { rows: [{ value }], rowCount: 1 };
    }
    return { rows: [{ value: 'Hi {first_name}, reply 1. A, 2. B, 3. C' }], rowCount: 1 };
  }
  // The first question of the lead's flow - db/flows.ts.
  if (/JOIN flow_questions fq ON fq.id = c.current_question_id/i.test(sql)) {
    return { rows: [{ body: 'Hi {first_name}, reply 1. A, 2. B, 3. C' }], rowCount: 1 };
  }
  if (/FROM dnc_list/i.test(sql)) {
    if (dncFails.has(String(values?.[0]))) throw new Error('connection reset');
    return dncRows;
  }
  if (/INSERT INTO leads/i.test(sql)) {
    const phone = String(values?.[0]);
    if (insertFails.has(phone)) throw new Error('could not write the lead');
    if (known) {
      if (known.has(phone)) return { rows: [], rowCount: 0 };
      known.add(phone);
    }
    return leadInsertReturns;
  }
  return { rows: [], rowCount: 1 };
}

const query = jest.fn(async (sql: string, values?: unknown[]) => {
  recorded.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
  return answer(sql, values);
});

jest.mock('../db/pool', () => ({
  pool: {
    query: (...a: unknown[]) => query(...(a as [string, unknown[]])),
    connect: async () => ({ query: (...a: unknown[]) => query(...(a as [string, unknown[]])), release: () => undefined }),
  },
}));

import * as logModule from '../lib/log';
import { MoreThanOneBucket } from '../db/buckets';
import { overlapMinutes, pollOnce } from './poller';

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
  checkpointValue = null;
  overlapValue = null;
  insertFails = new Set();
  dncFails = new Set();
  known = null;
  bucketRow = { id: 7, buckets: 1 };
  listContacts.mockReset();
  listContacts.mockResolvedValue({ content: [contact()], last: true });
});

describe('a contact EZ Texting has marked opted out', () => {
  it('is saved suppressed, blocked, and never texted', async () => {
    listContacts.mockResolvedValue({ content: [contact({ optOut: true })], last: true });

    const stats = await pollOnce();

    expect(stats).toMatchObject({ fetched: 1, inserted: 0, suppressed: 1, openersSent: 0 });
    expect(conversationInsert()?.values).toEqual([42, 'suppressed', 7]);
    // Blocked through db/dnc.ts, so the block and its activity-log record are
    // one statement - docs/AUDIT.md.
    const block = recorded.find((r) => /INSERT INTO dnc_list/i.test(r.sql));
    expect(block?.values).toEqual(['+15551230000', 'ezt_opt_out', null]);
    expect(block?.sql).toMatch(/INSERT INTO activity_log/i);
    expect(block?.sql).toMatch(/'dnc\.blocked'/);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('is not blocked a second time when we already hold a live block for it', async () => {
    dncRows = { rows: [{ '?column?': 1 }], rowCount: 1 };
    listContacts.mockResolvedValue({ content: [contact({ optOut: true })], last: true });

    const stats = await pollOnce();

    // Suppressed all the same, but the existing block keeps its own reason.
    expect(stats).toMatchObject({ suppressed: 1 });
    expect(sqlOf()).not.toMatch(/INSERT INTO dnc_list/i);
  });
});

describe('a phone already on our do-not-call list', () => {
  it('is saved suppressed and never texted', async () => {
    dncRows = { rows: [{ '?column?': 1 }], rowCount: 1 };

    const stats = await pollOnce();

    expect(stats).toMatchObject({ suppressed: 1, inserted: 0, openersSent: 0 });
    expect(conversationInsert()?.values).toEqual([42, 'suppressed', 7]);
    expect(sendMessage).not.toHaveBeenCalled();
    // Not opted out on EZ Texting's side: the poller blocks nothing itself.
    expect(sqlOf()).not.toMatch(/INSERT INTO dnc_list/i);
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
    // In the flow the bucket's new leads get, on its first question - the one bucket's (B08).
    expect(conversationInsert()?.values).toEqual([42, 'open', 7]);
    expect(conversationInsert()?.sql).toMatch(/FROM flows f .* WHERE f\.is_active AND f\.bucket_id = \$3/i);
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

  it('keeps the refused opener as a failed message, so the thread shows it', async () => {
    sendMessage.mockRejectedValue(new Error('EZ Texting down'));

    await pollOnce();

    const failed = query.mock.calls.find(([sql]) => /delivery_status/i.test(sql) && /'failed'/.test(sql));
    expect(failed).toBeDefined();
    // The rendered opener, not the template - it is what the agent would read.
    expect(String(failed?.[1]?.[1])).not.toContain('{first_name}');
  });

  it('a send that timed out may have gone: its reply window starts, so a reply counts - and it is not logged as failed (review H12, M15)', async () => {
    sendMessage.mockRejectedValue(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }));
    const errors: string[] = [];
    const spy = jest.spyOn(logModule.log, 'error').mockImplementation((event: string) => {
      errors.push(event);
    });

    await pollOnce();
    spy.mockRestore();

    expect(sqlOf()).toMatch(/SET expires_at = now\(\) \+ \(\$2 \|\| ' days'\)::interval, question_sent_at = now\(\)/i);
    expect(errors).not.toContain('sms.failed');
    expect(sqlOf()).not.toMatch(/'failed'/);
  });

  it('keeps nothing when the number is blocked - that send was never attempted', async () => {
    const blocked = Object.assign(new Error('blocked'), { name: 'BlockedNumberError' });
    sendMessage.mockRejectedValue(blocked);

    await pollOnce();

    expect(sqlOf()).not.toMatch(/'failed'/);
  });
});

describe('the checkpoint', () => {
  it('is not advanced when the fetch fails, so nothing is skipped next tick', async () => {
    listContacts.mockRejectedValue(new Error('EZ Texting down'));

    await expect(pollOnce()).rejects.toThrow('EZ Texting down');
    expect(sqlOf()).not.toMatch(/INSERT INTO settings/i);
  });

  it('is still written on a quiet poll, so its time says the worker polled', async () => {
    // Nothing new: the value stays, updated_at moves. Without this a quiet
    // account looked like a stopped worker - Jeel, 2026-09-28.
    listContacts.mockResolvedValue({ content: [], last: true });

    await pollOnce();

    expect(sqlOf()).toMatch(/INSERT INTO settings/i);
  });
});

describe('the overlap window (review M16)', () => {
  it.each([
    ['5', 5],
    ['2.5', 2.5],
    [null, 5],
    ['soon', 5],
    ['0', 5],
    ['-3', 5],
  ] as const)('poll_overlap_minutes %p: %p minutes - never none, or less', (raw, minutes) => {
    expect(overlapMinutes(raw)).toBe(minutes);
  });
});

describe('the checkpoint, against what EZ Texting lists (review Q6)', () => {
  const CHECKPOINT = new Date('2026-11-23T18:00:00.000Z');
  const minutesFrom = (minutes: number) => new Date(CHECKPOINT.getTime() + minutes * 60_000).toISOString();
  const leadsInserted = () => recorded.filter((r) => /INSERT INTO leads/i.test(r.sql)).map((r) => r.values?.[0]);
  const written = () => recorded.find((r) => /INSERT INTO settings/i.test(r.sql))?.values;

  beforeEach(() => {
    checkpointValue = CHECKPOINT.toISOString();
    overlapValue = '5';
  });

  it('takes in what is newer than the checkpoint less the overlap, and stops at the first older one', async () => {
    listContacts.mockResolvedValue({
      content: [
        contact({ phoneNumber: '15550000001', createdAt: minutesFrom(2) }),
        // Inside the overlap: a contact listed late is still taken in.
        contact({ phoneNumber: '15550000002', createdAt: minutesFrom(-4) }),
        // Exactly the cutoff, and older: already covered by an earlier poll.
        contact({ phoneNumber: '15550000003', createdAt: minutesFrom(-5) }),
        contact({ phoneNumber: '15550000004', createdAt: minutesFrom(-9) }),
      ],
      last: false,
    });

    const stats = await pollOnce();

    expect(leadsInserted()).toEqual(['+15550000001', '+15550000002']);
    expect(stats.fetched).toBe(4);
    // Reached the cutoff: no second page asked for.
    expect(listContacts).toHaveBeenCalledTimes(1);
    expect(written()).toEqual(['ezt_poll_checkpoint', minutesFrom(2)]);
  });

  it('reads the next page while every contact is newer, and writes the newest seen', async () => {
    listContacts
      .mockResolvedValueOnce({
        content: [
          contact({ phoneNumber: '15550000011', createdAt: minutesFrom(10) }),
          contact({ phoneNumber: '15550000012', createdAt: minutesFrom(8) }),
        ],
        last: false,
      })
      .mockResolvedValueOnce({ content: [contact({ phoneNumber: '15550000013', createdAt: minutesFrom(6) })], last: true });

    await pollOnce();

    expect(listContacts.mock.calls.map((c) => (c as unknown as [{ page: number }])[0].page)).toEqual([0, 1]);
    expect(leadsInserted()).toEqual(['+15550000011', '+15550000012', '+15550000013']);
    expect(written()).toEqual(['ezt_poll_checkpoint', minutesFrom(10)]);
  });

  it('nothing newer: the same value written back', async () => {
    listContacts.mockResolvedValue({ content: [contact({ createdAt: minutesFrom(-30) })], last: true });

    await pollOnce();

    expect(leadsInserted()).toEqual([]);
    expect(written()).toEqual(['ezt_poll_checkpoint', CHECKPOINT.toISOString()]);
  });

  it('a page listed oldest first is refused, and the checkpoint left alone', async () => {
    listContacts.mockResolvedValue({
      content: [contact({ phoneNumber: '15550000021', createdAt: minutesFrom(1) }), contact({ phoneNumber: '15550000022', createdAt: minutesFrom(3) })],
      last: true,
    });

    await expect(pollOnce()).rejects.toThrow('oldest-first');
    expect(leadsInserted()).toEqual([]);
    expect(written()).toBeUndefined();
  });

  it('a checkpoint that is missing, or not a time, looks back an hour', async () => {
    for (const stored of [null, 'not a time']) {
      recorded.length = 0;
      checkpointValue = stored;
      const now = Date.now();
      listContacts.mockResolvedValue({
        content: [
          contact({ phoneNumber: '15550000031', createdAt: new Date(now - 30 * 60_000).toISOString() }),
          contact({ phoneNumber: '15550000032', createdAt: new Date(now - 2 * 60 * 60_000).toISOString() }),
        ],
        last: true,
      });

      await pollOnce();

      expect([stored, leadsInserted()]).toEqual([stored, ['+15550000031']]);
    }
  });

  it('the overlap is read from its own setting', async () => {
    overlapValue = '10';
    listContacts.mockResolvedValue({ content: [contact({ phoneNumber: '15550000041', createdAt: minutesFrom(-8) })], last: true });

    await pollOnce();

    expect(leadsInserted()).toEqual(['+15550000041']);
  });
});

describe('one bucket - B08', () => {
  it('with a second bucket, fails the poll loudly - before reading EZ Texting, so nobody is taken in', async () => {
    bucketRow = { id: 7, buckets: 2 };

    await expect(pollOnce()).rejects.toBeInstanceOf(MoreThanOneBucket);
    expect(listContacts).not.toHaveBeenCalled();
    expect(sqlOf()).not.toMatch(/INSERT INTO (leads|conversations)/i);
    // The checkpoint stays, and no read is recorded: health goes degraded.
    expect(sqlOf()).not.toMatch(/INSERT INTO settings/i);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('one contact never stops the rest - B06', () => {
  const CHECKPOINT = new Date('2026-11-23T18:00:00.000Z');
  const minutesFrom = (minutes: number) => new Date(CHECKPOINT.getTime() + minutes * 60_000).toISOString();
  const checkpointWritten = () =>
    recorded.find((r) => /INSERT INTO settings/i.test(r.sql) && r.values?.[0] === 'ezt_poll_checkpoint')?.values?.[1];
  const page = () => ({
    content: [
      contact({ phoneNumber: '15550000051', createdAt: minutesFrom(10) }),
      contact({ phoneNumber: '15550000052', createdAt: minutesFrom(6) }),
      contact({ phoneNumber: '15550000053', createdAt: minutesFrom(2) }),
    ],
    last: true,
  });

  beforeEach(() => {
    checkpointValue = CHECKPOINT.toISOString();
    overlapValue = '5';
    known = new Set();
    listContacts.mockResolvedValue(page());
  });

  it.each([
    ['its lead cannot be written', () => insertFails.add('+15550000052')],
    ['its do-not-call check throws', () => dncFails.add('+15550000052')],
  ])('when %s: the others are taken in and texted, it is counted, and the checkpoint stops just before it', async (_label, fail) => {
    fail();
    const errors = jest.spyOn(logModule.log, 'error').mockImplementation(() => undefined);

    const stats = await pollOnce();

    expect(stats).toMatchObject({ fetched: 3, inserted: 2, openersSent: 2, failed: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(checkpointWritten()).toBe(new Date(Date.parse(minutesFrom(6)) - 1).toISOString());
    // Logged without the phone or the name: when EZ Texting listed it, and the error.
    const failed = errors.mock.calls.filter(([event]) => event === 'poll.contact_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0][1]).toEqual({ createdAt: minutesFrom(6), err: expect.any(String) });
    expect(JSON.stringify(failed[0][1])).not.toMatch(/5550000052|Ada/);
    errors.mockRestore();
  });

  it.each([
    ['its lead could not be written', () => insertFails.add('+15550000052'), () => insertFails.clear()],
    ['its do-not-call check threw', () => dncFails.add('+15550000052'), () => dncFails.clear()],
  ])('when %s, the next poll reads it again and takes it in; the two before are skipped as phones we hold', async (_label, fail, mend) => {
    fail();
    jest.spyOn(logModule.log, 'error').mockImplementation(() => undefined);
    await pollOnce();

    checkpointValue = checkpointWritten() as string;
    mend();
    recorded.length = 0;
    sendMessage.mockClear();
    const again = await pollOnce();

    expect(again).toMatchObject({ inserted: 1, skipped: 2, failed: 0 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(checkpointWritten()).toBe(minutesFrom(10));
    jest.restoreAllMocks();
  });

  it('two that fail: the checkpoint stops before the older', async () => {
    insertFails.add('+15550000051').add('+15550000053');
    jest.spyOn(logModule.log, 'error').mockImplementation(() => undefined);

    const stats = await pollOnce();

    expect(stats).toMatchObject({ inserted: 1, failed: 2 });
    expect(checkpointWritten()).toBe(new Date(Date.parse(minutesFrom(2)) - 1).toISOString());
    jest.restoreAllMocks();
  });

  it('one inside the overlap, older than the checkpoint: the checkpoint goes back to just before it', async () => {
    listContacts.mockResolvedValue({ content: [contact({ phoneNumber: '15550000054', createdAt: minutesFrom(-3) })], last: true });
    insertFails.add('+15550000054');
    jest.spyOn(logModule.log, 'error').mockImplementation(() => undefined);

    await pollOnce();

    expect(checkpointWritten()).toBe(new Date(Date.parse(minutesFrom(-3)) - 1).toISOString());
    jest.restoreAllMocks();
  });
});

describe('when EZ Texting was last read - B06', () => {
  const readWritten = () => recorded.some((r) => /INSERT INTO settings/i.test(r.sql) && r.values?.[0] === 'ezt_last_read_at');

  it('is written on a quiet poll', async () => {
    listContacts.mockResolvedValue({ content: [], last: true });
    await pollOnce();
    expect(readWritten()).toBe(true);
  });

  it('and on a poll where a contact failed - it read the account all the same', async () => {
    insertFails.add('+15551230000');
    jest.spyOn(logModule.log, 'error').mockImplementation(() => undefined);
    expect((await pollOnce()).failed).toBe(1);
    expect(readWritten()).toBe(true);
    jest.restoreAllMocks();
  });

  it('but not when the fetch failed', async () => {
    listContacts.mockRejectedValue(new Error('EZ Texting down'));
    await expect(pollOnce()).rejects.toThrow('EZ Texting down');
    expect(readWritten()).toBe(false);
  });
});
