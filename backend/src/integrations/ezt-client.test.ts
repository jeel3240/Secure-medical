/**
 * The dnc_list guard on sendMessage. Honouring an opt-out is a compliance
 * obligation, so this is the test that matters most in this file: the check
 * lives inside the send path precisely so no caller can forget it.
 */
jest.mock('../config', () => ({
  config: {
    ezt: { username: 'u', password: 'p', sendGroup: 'weightloss', group: 'weightloss', source: 'API' },
  },
}));

const poolQuery = jest.fn();
jest.mock('../db/pool', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...(a as [string])) } }));

const post = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => post(...(a as [])), get: jest.fn() },
}));

import { BlockedNumberError, sendMessage } from './ezt-client';

beforeEach(() => {
  poolQuery.mockReset();
  post.mockReset();
  post.mockResolvedValue({ data: { id: 'sent-1' } });
});

/** No row in dnc_list for the numbers asked about. */
const notBlocked = () => poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

describe('sendMessage', () => {
  it('sends when the number is not blocked', async () => {
    notBlocked();

    const result = await sendMessage(['+16026203572'], 'hello');

    expect(result.id).toBe('sent-1');
    expect(post).toHaveBeenCalledTimes(1);
    // The API wants the number without the +.
    expect(post.mock.calls[0][1]).toMatchObject({ toNumbers: ['16026203572'], message: 'hello' });
  });

  it('refuses when the number is on dnc_list, and sends nothing', async () => {
    poolQuery.mockResolvedValue({ rows: [{ phone: '+16026203572' }], rowCount: 1 });

    await expect(sendMessage(['+16026203572'], 'hello')).rejects.toThrow(BlockedNumberError);
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses the whole send when any recipient is blocked', async () => {
    poolQuery.mockResolvedValue({ rows: [{ phone: '+15550000002' }], rowCount: 1 });

    await expect(sendMessage(['+15550000001', '+15550000002'], 'hi')).rejects.toThrow(
      BlockedNumberError
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('checks the list before calling the API, not after', async () => {
    const order: string[] = [];
    poolQuery.mockImplementation(async () => {
      order.push('dnc');
      return { rows: [], rowCount: 0 };
    });
    post.mockImplementation(async () => {
      order.push('post');
      return { data: { id: 'sent-1' } };
    });

    await sendMessage(['+16026203572'], 'hello');

    expect(order).toEqual(['dnc', 'post']);
  });

  it('normalises a bare number before comparing, so it cannot slip through', async () => {
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await sendMessage(['16026203572'], 'hello');

    // dnc_list stores E.164; querying the bare form would match nothing.
    expect(poolQuery.mock.calls[0][1]).toEqual([['+16026203572']]);
  });

  it('refuses before touching the database when EZT_SEND_GROUP is unset', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../config') as { config: { ezt: { sendGroup: string } } };
    config.ezt.sendGroup = '';

    await expect(sendMessage(['+16026203572'], 'hello')).rejects.toThrow(/EZT_SEND_GROUP/);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();

    config.ezt.sendGroup = 'weightloss';
  });
});
