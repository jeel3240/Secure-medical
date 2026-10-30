/**
 * Placing one automated call - T12, AUTO-CALLS.md. The database and Twilio are
 * replaced: the order of the steps, and what each answer leaves behind. The
 * SQL is proved by scripts/auto-calls-live-check.ts.
 */
import type { AutoCallNumbers } from '../auto-calls-settings';
import type { PlaceResult } from '../integrations/twilio-calls';
import type { TwilioSettings } from '../twilio-settings';

type StartArgs = Parameters<typeof import('../db/auto-calls').startAutomatedCall>;
const startAutomatedCall = jest.fn<ReturnType<typeof import('../db/auto-calls').startAutomatedCall>, StartArgs>();
const linkAutomatedCall = jest.fn();
const failAutomatedCall = jest.fn();
jest.mock('../db/auto-calls', () => ({
  startAutomatedCall: (...a: StartArgs) => startAutomatedCall(...a),
  linkAutomatedCall: (...a: unknown[]) => linkAutomatedCall(...a),
  failAutomatedCall: (...a: unknown[]) => failAutomatedCall(...a),
}));
const placeAutomatedCall = jest.fn<Promise<PlaceResult>, unknown[]>();
jest.mock('../integrations/twilio-calls', () => ({ placeAutomatedCall: (...a: unknown[]) => placeAutomatedCall(...a) }));

import { placeAutoCall } from './place-auto-call';

const SETTINGS = { callerId: '+14805308582', publicUrl: 'https://calls.example.com' } as TwilioSettings;
const ONLY_OURS: AutoCallNumbers = { only: new Set(['+16025550123']), invalid: 0 };
const place = () => placeAutoCall({ leadId: 7, settings: SETTINGS, numbers: ONLY_OURS });

beforeEach(() => {
  startAutomatedCall.mockReset().mockResolvedValue({ ok: true, callId: 42, phone: '+16025550123' });
  linkAutomatedCall.mockReset().mockResolvedValue(true);
  failAutomatedCall.mockReset().mockResolvedValue(undefined);
  placeAutomatedCall.mockReset().mockResolvedValue({ kind: 'placed', callSid: 'CA900' });
});

it('writes the row first, then asks Twilio to ring the lead for it, then keeps Twilio\'s id', async () => {
  expect(await place()).toEqual({ kind: 'placed', callId: 42 });
  expect(startAutomatedCall.mock.invocationCallOrder[0]).toBeLessThan(placeAutomatedCall.mock.invocationCallOrder[0]);
  expect(placeAutomatedCall).toHaveBeenCalledWith(SETTINGS, { to: '+16025550123', callId: 42 });
  expect(linkAutomatedCall).toHaveBeenCalledWith(42, 'CA900');
});

it('the row is told which numbers may ring - only ours, outside production', async () => {
  await place();
  const { mayRing } = startAutomatedCall.mock.calls[0][0];
  expect(mayRing('+16025550123')).toBe(true);
  expect(mayRing('+16025550199')).toBe(false);
});

it('refused before Twilio - blocked, already called, not one of ours: nothing rings', async () => {
  startAutomatedCall.mockResolvedValue({ ok: false, reason: 'not_test_number' });
  expect(await place()).toEqual({ kind: 'refused', reason: 'not_test_number' });
  expect(placeAutomatedCall).not.toHaveBeenCalled();
});

it('Twilio refuses the lead\'s number: the row is ended as failed, the lead\'s call - with Twilio\'s status and code', async () => {
  placeAutomatedCall.mockResolvedValue({ kind: 'refused', status: 400, code: 21211 });
  expect(await place()).toEqual({ kind: 'failed', callId: 42 });
  expect(failAutomatedCall).toHaveBeenCalledWith(42, { status: 400, code: 21211, forTheNumber: true });
  expect(linkAutomatedCall).not.toHaveBeenCalled();
});

it('Twilio refuses for our account - the key, a limit: ended as failed, not placed - not the lead\'s call', async () => {
  for (const [status, code] of [
    [401, 20003],
    [429, 20429],
    [403, null],
  ] as const) {
    failAutomatedCall.mockClear();
    placeAutomatedCall.mockResolvedValue({ kind: 'refused', status, code });
    expect(await place()).toEqual({ kind: 'notPlaced', callId: 42 });
    expect(failAutomatedCall).toHaveBeenCalledWith(42, { status, code, forTheNumber: false });
  }
});

it('no answer from Twilio: the row is left for the webhooks - the call may have gone out', async () => {
  placeAutomatedCall.mockResolvedValue({ kind: 'unknown', error: 'ECONNABORTED' });
  expect(await place()).toEqual({ kind: 'unconfirmed', callId: 42 });
  expect(failAutomatedCall).not.toHaveBeenCalled();
  expect(linkAutomatedCall).not.toHaveBeenCalled();
});

it('placed, but its id could not be kept: still placed - the call\'s first webhook keeps it', async () => {
  linkAutomatedCall.mockRejectedValue(new Error('connection lost'));
  expect(await place()).toEqual({ kind: 'placed', callId: 42 });
});
