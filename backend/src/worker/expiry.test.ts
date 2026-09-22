/**
 * The expiry sweep, with the database mocked. What matters here is the SQL's
 * shape - which statuses it touches and how a missing expires_at is handled -
 * so the assertions are on the statement, not on rows.
 */
jest.mock('../config', () => ({ config: { databaseUrl: 'postgres://test' } }));

const poolQuery = jest.fn();
jest.mock('../db/pool', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...(a as [string])) } }));

import { expireStaleConversations } from './expiry';

/** settings.expiry_days, then the UPDATE. */
function respond(days: string | undefined, expired: number) {
  poolQuery.mockReset();
  poolQuery.mockImplementation(async (sql: string) => {
    if (/FROM settings/i.test(sql)) {
      return days === undefined ? { rows: [], rowCount: 0 } : { rows: [{ value: days }], rowCount: 1 };
    }
    return { rows: [], rowCount: expired };
  });
}

const updateSql = () =>
  (poolQuery.mock.calls.find((c) => /UPDATE conversations/i.test(c[0] as string))?.[0] as string).replace(
    /\s+/g,
    ' '
  );

const updateValues = () =>
  poolQuery.mock.calls.find((c) => /UPDATE conversations/i.test(c[0] as string))?.[1];

describe('expireStaleConversations', () => {
  it('reports how many it expired', async () => {
    respond('7', 3);
    const sweep = await expireStaleConversations();
    expect(sweep.expired).toBe(3);
    expect(sweep.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('only ever touches open conversations', async () => {
    respond('7', 0);
    await expireStaleConversations();

    // completed, review and suppressed are not waiting on the lead; suppressed
    // in particular must never be reopened or changed.
    expect(updateSql()).toMatch(/WHERE status = 'open'/);
    expect(updateSql()).toMatch(/SET status = 'expired'/);
  });

  it('falls back to created_at when expires_at was never set', async () => {
    respond('7', 0);
    await expireStaleConversations();

    // Conversations created before the poller set expires_at have none. Without
    // the fallback they would stay open forever.
    expect(updateSql()).toMatch(/COALESCE\(expires_at, created_at/);
  });

  it('uses the admin-editable window', async () => {
    respond('14', 0);
    await expireStaleConversations();
    expect(updateValues()).toEqual(['14']);
  });

  it('falls back to 7 days when the setting is missing', async () => {
    respond(undefined, 0);
    await expireStaleConversations();
    expect(updateValues()).toEqual(['7']);
  });

  it('falls back to 7 days when the setting is not a usable number', async () => {
    for (const bad of ['banana', '0', '-3']) {
      respond(bad, 0);
      await expireStaleConversations();
      expect(updateValues()).toEqual(['7']);
    }
  });

  it('sends nothing', async () => {
    respond('7', 5);
    await expireStaleConversations();

    // Expiry is silent by design: the lead has gone quiet, and a message
    // telling them so would be an unprompted text to someone disengaged.
    const sql = poolQuery.mock.calls.map((c) => c[0]).join(' || ');
    expect(sql).not.toMatch(/INSERT INTO messages/i);
  });
});
