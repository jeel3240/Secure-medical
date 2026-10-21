/**
 * Asking Twilio to place an automated call - T12, AUTO-CALLS.md. The library
 * is replaced: what is asked for, and what each kind of answer becomes.
 */
import type { TwilioSettings } from '../twilio-settings';

const create = jest.fn();
const list = jest.fn();
const client = jest.fn((..._args: unknown[]) => ({ calls: { create, list } }));
jest.mock('twilio', () => (...args: unknown[]) => client(...args));

// After the mock, so the module sees it.
import { automatedCallRequest, LEAD_RING_SECONDS, placeAutomatedCall, transferRings } from './twilio-calls';

const SETTINGS: TwilioSettings = {
  accountSid: `AC${'1'.repeat(32)}`,
  authToken: 'f'.repeat(32),
  apiKey: `SK${'2'.repeat(32)}`,
  apiSecret: 'S'.repeat(32),
  twimlAppSid: `AP${'3'.repeat(32)}`,
  callerId: '+14805308582',
  publicUrl: 'https://calls.example.com',
  identityPrefix: 'dev-',
};
const BASE = 'https://calls.example.com/api/webhooks/twilio/auto';

beforeEach(() => {
  create.mockReset();
  list.mockReset();
  client.mockClear();
});

describe('what Twilio is asked for', () => {
  it('rings the lead from our number; every webhook names the call\'s row; voicemail detection beside the call', () => {
    expect(automatedCallRequest(SETTINGS, { to: '+16025550123', callId: 42 })).toEqual({
      to: '+16025550123',
      from: '+14805308582',
      url: `${BASE}/answer?call=42`,
      method: 'POST',
      statusCallback: `${BASE}/status?call=42`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['completed'],
      timeout: LEAD_RING_SECONDS,
      machineDetection: 'DetectMessageEnd',
      asyncAmd: 'true',
      asyncAmdStatusCallback: `${BASE}/amd?call=42`,
      asyncAmdStatusCallbackMethod: 'POST',
    });
  });
});

describe('placing it', () => {
  it('asks once, with a time limit and the library\'s own retry off, and keeps Twilio\'s id', async () => {
    create.mockResolvedValue({ sid: 'CA900' });
    const result = await placeAutomatedCall(SETTINGS, { to: '+16025550123', callId: 42 });
    expect(result).toEqual({ kind: 'placed', callSid: 'CA900' });
    expect(client).toHaveBeenCalledWith(SETTINGS.accountSid, SETTINGS.authToken, { timeout: 10_000, autoRetry: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(automatedCallRequest(SETTINGS, { to: '+16025550123', callId: 42 }));
  });

  it('a refusal from Twilio (4xx): refused, keeping its status and code - never its message, which can quote the number', async () => {
    create.mockRejectedValue(
      Object.assign(new Error("The 'To' number +16025550123 is not a valid phone number."), { status: 400, code: 21211 })
    );
    const result = await placeAutomatedCall(SETTINGS, { to: '+16025550123', callId: 42 });
    expect(result).toEqual({ kind: 'refused', status: 400, code: 21211 });
    expect(JSON.stringify(result)).not.toContain('602');
  });

  it.each([
    ['a request that timed out', Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }), 'ECONNABORTED'],
    ['a fault on Twilio\'s side', Object.assign(new Error('Service Unavailable'), { status: 503 }), 'http_503'],
    ['anything else', new Error('socket hang up'), 'no_response'],
  ])('%s: unknown - it may have gone out - and never asked again', async (_, error, said) => {
    create.mockRejectedValue(error);
    expect(await placeAutomatedCall(SETTINGS, { to: '+16025550123', callId: 42 })).toEqual({ kind: 'unknown', error: said });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('how a transfer\'s rings ended (T15c)', () => {
  it('the automated call\'s child calls - who was rung, and how each ring ended', async () => {
    const at = new Date('2026-10-20T23:46:20Z');
    list.mockResolvedValue([
      { to: 'client:dev-agent-16', status: 'no-answer', startTime: at, from: '+14805308582' },
      { to: 'client:dev-agent-19', status: 'busy', startTime: null, from: '+14805308582' },
    ]);
    expect(await transferRings(SETTINGS, 'CA900')).toEqual([
      { to: 'client:dev-agent-16', status: 'no-answer', startedAt: at },
      { to: 'client:dev-agent-19', status: 'busy', startedAt: null },
    ]);
    expect(list).toHaveBeenCalledWith({ parentCallSid: 'CA900', limit: 50 });
  });

  it('Twilio cannot be asked: null, never a throw - nobody\'s switch is changed on a guess', async () => {
    list.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    expect(await transferRings(SETTINGS, 'CA900')).toBeNull();
  });
});
