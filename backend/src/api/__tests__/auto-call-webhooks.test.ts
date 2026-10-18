/**
 * The automated call's webhooks - T12, AUTO-CALLS.md. The database is
 * replaced; what is under test is who may reach them, what the lead hears, and
 * what each is saved as. The SQL is proved by scripts/auto-calls-live-check.ts.
 */
import request from 'supertest';
import twilio from 'twilio';
import { ANTIBIOTICS_CALL, OFFER_STEP } from '../../core/call-script-fixtures';
import type { CallScript } from '../../core/call-script';
import type { TwilioSettings } from '../../twilio-settings';
import { buildApp } from './helpers';

const linkAutomatedCall = jest.fn<Promise<boolean>, [number, string]>();
jest.mock('../../db/auto-calls', () => ({
  linkAutomatedCall: (...a: [number, string]) => linkAutomatedCall(...a),
}));
const loadActiveCallScript = jest.fn<Promise<CallScript | null>, unknown[]>();
jest.mock('../../db/call-script', () => ({ loadActiveCallScript: (...a: unknown[]) => loadActiveCallScript(...a) }));
const finishCall = jest.fn();
const recordAnsweredBy = jest.fn();
jest.mock('../../db/calls', () => ({
  finishCall: (...a: unknown[]) => finishCall(...a),
  recordAnsweredBy: (...a: unknown[]) => recordAnsweredBy(...a),
}));
const sendMissedCallText = jest.fn();
jest.mock('../../db/missed-call-text', () => ({ sendMissedCallText: (...a: unknown[]) => sendMissedCallText(...a) }));
const poolQuery = jest.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 1 }));
jest.mock('../../db/pool', () => ({ pool: { query: (...a: [string, unknown[]?]) => poolQuery(...a) } }));

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
const ANSWER = '/api/webhooks/twilio/auto/answer?call=42';
const PICKED_UP = { CallSid: 'CA900', CallStatus: 'in-progress' };

/** Posts form fields the way Twilio does, signed against the full address - query string included. */
function fromTwilio(app: string, path: string, params: Record<string, string>, signWith = SETTINGS.authToken) {
  const signature = twilio.getExpectedTwilioSignature(signWith, SETTINGS.publicUrl + path, params);
  return request(app).post(path).type('form').set('X-Twilio-Signature', signature).send(params);
}
const on = () => buildApp({ twilio: SETTINGS, autoCalls: true });

beforeEach(() => {
  linkAutomatedCall.mockReset().mockResolvedValue(true);
  loadActiveCallScript.mockReset().mockResolvedValue(ANTIBIOTICS_CALL);
  finishCall.mockReset().mockResolvedValue({ recorded: true, missedLeadId: null });
  recordAnsweredBy.mockReset().mockResolvedValue(true);
  sendMissedCallText.mockReset();
  poolQuery.mockClear();
});

describe('who may reach them', () => {
  it('nobody while automated calls are off - not even Twilio: they do not exist', async () => {
    const { app } = await buildApp({ twilio: SETTINGS, autoCalls: false });
    expect((await fromTwilio(app, ANSWER, PICKED_UP)).status).toBe(404);
    expect(linkAutomatedCall).not.toHaveBeenCalled();
  });

  it('nobody with calling off', async () => {
    const { app } = await buildApp({ autoCalls: true });
    expect((await fromTwilio(app, ANSWER, PICKED_UP)).status).toBe(404);
  });

  it('only Twilio: unsigned, or signed for another address, is refused before the database', async () => {
    const { app } = await on();
    expect((await request(app).post(ANSWER).type('form').send(PICKED_UP)).status).toBe(403);
    expect((await fromTwilio(app, ANSWER, PICKED_UP, '0'.repeat(32))).status).toBe(403);
    // Signed for call 42, sent as call 43: the row named is part of what is signed.
    const signature = twilio.getExpectedTwilioSignature(SETTINGS.authToken, SETTINGS.publicUrl + ANSWER, PICKED_UP);
    const moved = await request(app)
      .post('/api/webhooks/twilio/auto/answer?call=43')
      .type('form')
      .set('X-Twilio-Signature', signature)
      .send(PICKED_UP);
    expect(moved.status).toBe(403);
    expect(linkAutomatedCall).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('keeps each request as it arrived, address and all', async () => {
    const { app } = await on();
    await fromTwilio(app, ANSWER, PICKED_UP);
    const [sql, values] = poolQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO webhook_events/);
    expect(values).toEqual(['twilio', ANSWER, JSON.stringify(PICKED_UP)]);
  });
});

describe('the lead picks up', () => {
  it('a second of quiet, then question 1, listening - on the row the address names, linked to Twilio\'s id', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, ANSWER, PICKED_UP);
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/xml');
    expect(linkAutomatedCall).toHaveBeenCalledWith(42, 'CA900');
    expect(res.text).toContain('<Pause length="1"/><Gather');
    expect(res.text).toContain('Are you interested in ordering antibiotics at 25% off today?');
    expect(res.text).toContain(`/auto/gather?call=42&amp;step=${OFFER_STEP}&amp;try=1`);
  });

  it.each([
    ['names no row', '/api/webhooks/twilio/auto/answer', PICKED_UP],
    ['names something that is not a row', '/api/webhooks/twilio/auto/answer?call=abc', PICKED_UP],
    ['names row 0', '/api/webhooks/twilio/auto/answer?call=0', PICKED_UP],
    ['has no call id', ANSWER, { CallStatus: 'in-progress' }],
  ])('a request that %s: the call ends, nothing is looked up', async (_, path, params) => {
    const { app } = await on();
    const res = await fromTwilio(app, path, params);
    expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
    expect(linkAutomatedCall).not.toHaveBeenCalled();
  });

  it('a row that is not this call - another call\'s, or not automated: the call ends', async () => {
    linkAutomatedCall.mockResolvedValue(false);
    const { app } = await on();
    expect((await fromTwilio(app, ANSWER, PICKED_UP)).text).toMatch(/<Response><Hangup\/><\/Response>$/);
    expect(loadActiveCallScript).not.toHaveBeenCalled();
  });

  it('no script, or the database failing: the call ends quietly - never Twilio\'s "application error"', async () => {
    const { app } = await on();
    loadActiveCallScript.mockResolvedValue(null);
    expect((await fromTwilio(app, ANSWER, PICKED_UP)).text).toMatch(/<Hangup\/>/);
    linkAutomatedCall.mockRejectedValue(new Error('connection refused'));
    const failed = await fromTwilio(app, ANSWER, PICKED_UP);
    expect(failed.status).toBe(200);
    expect(failed.text).toMatch(/<Response><Hangup\/><\/Response>$/);
  });
});

describe('the lead answers (T12: thanked, and the call ends - T13 reads the answer)', () => {
  it('whatever was said', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, `/api/webhooks/twilio/auto/gather?call=42&step=${OFFER_STEP}&try=1`, {
      CallSid: 'CA900',
      SpeechResult: 'Yes please',
      Confidence: '0.9',
    });
    expect(res.text).toContain('Thank you for your time. Have a great day.</Say><Hangup/>');
    expect(res.text).not.toContain('<Gather');
  });
});

describe('how it ended', () => {
  const STATUS = '/api/webhooks/twilio/auto/status?call=42';

  it('is saved on the row, as every call\'s end is - answered, with its length', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, STATUS, { CallSid: 'CA900', CallStatus: 'completed', CallDuration: '31' });
    expect(res.status).toBe(204);
    expect(linkAutomatedCall).toHaveBeenCalledWith(42, 'CA900');
    expect(finishCall).toHaveBeenCalledWith({ callSid: 'CA900', outcome: 'answered', durationSec: 31 });
    expect(sendMissedCallText).not.toHaveBeenCalled();
  });

  it('a call nobody answered is no answer, with no talk time - and never a missed-call text', async () => {
    const { app } = await on();
    await fromTwilio(app, STATUS, { CallSid: 'CA900', CallStatus: 'no-answer', CallDuration: '0' });
    expect(finishCall).toHaveBeenCalledWith({ callSid: 'CA900', outcome: 'no_answer', durationSec: 0 });
    expect(sendMissedCallText).not.toHaveBeenCalled();
  });

  it('a report about a row that is not this call saves nothing', async () => {
    linkAutomatedCall.mockResolvedValue(false);
    const { app } = await on();
    expect((await fromTwilio(app, STATUS, { CallSid: 'CA999', CallStatus: 'completed', CallDuration: '5' })).status).toBe(204);
    expect(finishCall).not.toHaveBeenCalled();
  });
});

describe('who picked up', () => {
  const AMD = '/api/webhooks/twilio/auto/amd?call=42';

  it('is kept on the row: a machine, however Twilio words it', async () => {
    const { app } = await on();
    expect((await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'machine_end_beep' })).status).toBe(204);
    expect(recordAnsweredBy).toHaveBeenCalledWith({ callSid: 'CA900', answeredBy: 'machine' });
  });

  it('a verdict it does not know is ignored', async () => {
    const { app } = await on();
    await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'robot' });
    expect(recordAnsweredBy).not.toHaveBeenCalled();
  });
});
