/**
 * The automated call's webhooks - T12, AUTO-CALLS.md. The database is
 * replaced; what is under test is who may reach them, what the lead hears, and
 * what each is saved as. The SQL is proved by scripts/auto-calls-live-check.ts.
 */
import request from 'supertest';
import twilio from 'twilio';
import { ANTIBIOTICS_CALL, LINK_STEP, OFFER_STEP } from '../../core/call-script-fixtures';
import type { CallScript } from '../../core/call-script';
import type { TwilioSettings } from '../../twilio-settings';
import { buildApp } from './helpers';

const linkAutomatedCall = jest.fn<Promise<boolean>, [number, string]>();
type KeepArgs = Parameters<typeof import('../../db/auto-calls').keepAnswer>;
const keepAnswer = jest.fn<Promise<{ kept: boolean; leadId: number | null }>, KeepArgs>();
const settleAutomatedCall = jest.fn();
jest.mock('../../db/auto-calls', () => ({
  linkAutomatedCall: (...a: [number, string]) => linkAutomatedCall(...a),
  keepAnswer: (...a: KeepArgs) => keepAnswer(...a),
  settleAutomatedCall: (...a: unknown[]) => settleAutomatedCall(...a),
}));
const loadActiveCallScript = jest.fn<Promise<CallScript | null>, unknown[]>();
const readMinConfidence = jest.fn<Promise<number>, unknown[]>();
jest.mock('../../db/call-script', () => ({
  loadActiveCallScript: (...a: unknown[]) => loadActiveCallScript(...a),
  readMinConfidence: (...a: unknown[]) => readMinConfidence(...a),
}));
const finishCall = jest.fn();
const recordAnsweredBy = jest.fn();
jest.mock('../../db/calls', () => ({
  finishCall: (...a: unknown[]) => finishCall(...a),
  recordAnsweredBy: (...a: unknown[]) => recordAnsweredBy(...a),
}));
const sendMissedCallText = jest.fn();
const sendCallLinkText = jest.fn<Promise<boolean>, [number]>();
jest.mock('../../db/lead-texts', () => ({
  sendMissedCallText: (...a: unknown[]) => sendMissedCallText(...a),
  sendCallLinkText: (leadId: number) => sendCallLinkText(leadId),
}));
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
  keepAnswer.mockReset().mockResolvedValue({ kept: true, leadId: 7 });
  sendCallLinkText.mockReset().mockResolvedValue(true);
  settleAutomatedCall.mockReset().mockResolvedValue(undefined);
  loadActiveCallScript.mockReset().mockResolvedValue(ANTIBIOTICS_CALL);
  readMinConfidence.mockReset().mockResolvedValue(0.4);
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
    expect(res.text).toContain("<Pause length=\"1\"/><Say voice=\"Google.en-US-Chirp3-HD-Kore\">Hi, this is Seri calling from eDrugstore. Today we're offering 25% off antibiotics.</Say><Gather");
    expect(res.text).toContain('<Say voice="Google.en-US-Chirp3-HD-Kore">Are you interested in ordering?</Say></Gather>');
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

describe('the lead answers (T13)', () => {
  const gather = (step: number, attempt: number) => `/api/webhooks/twilio/auto/gather?call=42&step=${step}&try=${attempt}`;
  const said = (words: string, confidence = '0.9') => ({ CallSid: 'CA900', CallStatus: 'in-progress', SpeechResult: words, Confidence: confidence });
  const kept = () => keepAnswer.mock.calls[0][0];

  it('"yes please" to the offer: kept as Yes; nobody can take it until T15 - the busy line, transfer_missed', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, gather(OFFER_STEP, 1), said('Yes please'));
    expect(kept()).toEqual({
      callId: 42,
      step: { id: OFFER_STEP, key: 'q1' },
      attempt: 1,
      spoken: { heard: 'Yes please', digits: null, confidence: 0.9 },
      record: { result: 'choice', choiceKey: '1', choiceLabel: 'Yes' },
      result: 'transfer_missed',
      blockNumber: false,
    });
    expect(res.text).toContain('Please hold.</Say><Say voice="Google.en-US-Chirp3-HD-Kore">All our agents are busy right now.');
    expect(res.text).toMatch(/<Hangup\/><\/Response>$/);
  });

  it('"no" to the offer: the reply and the link question, listening on the next step', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, gather(OFFER_STEP, 1), said("No, I'm not interested"));
    expect(kept()).toMatchObject({ record: { choiceLabel: 'No' }, result: null });
    expect(res.text).toContain("No problem - I'll just ask one more quick thing.");
    expect(res.text).toContain('Can we send you a link');
    expect(res.text).toContain(`step=${LINK_STEP}&amp;try=1`);
  });

  it('key 2 on the link: not interested, thanked, and the call ends', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, gather(LINK_STEP, 1), { CallSid: 'CA900', CallStatus: 'in-progress', Digits: '2' });
    expect(kept()).toMatchObject({ spoken: { heard: null, digits: '2', confidence: null }, result: 'not_interested' });
    expect(res.text).toContain('Thank you for your time. Have a great day.</Say><Hangup/>');
  });

  describe('a yes to the link (T14)', () => {
    const yesToLink = { CallSid: 'CA900', CallStatus: 'in-progress', Digits: '1' };

    it('is texted to the call\'s lead - once the answer is kept', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, gather(LINK_STEP, 1), yesToLink);
      expect(res.text).toContain('Perfect. Check your SMS.');
      expect(kept()).toMatchObject({ result: 'link_sent' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendCallLinkText).toHaveBeenCalledTimes(1);
      expect(sendCallLinkText).toHaveBeenCalledWith(7);
      expect(keepAnswer.mock.invocationCallOrder[0]).toBeLessThan(sendCallLinkText.mock.invocationCallOrder[0]);
    });

    it('never twice: the same request again keeps nothing new, and texts nothing', async () => {
      keepAnswer.mockResolvedValue({ kept: false, leadId: 7 });
      const { app } = await on();
      await fromTwilio(app, gather(LINK_STEP, 1), yesToLink);
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendCallLinkText).not.toHaveBeenCalled();
    });

    it('a yes said as the lead hung up is still texted - they asked for it', async () => {
      const { app } = await on();
      await fromTwilio(app, gather(LINK_STEP, 1), { ...yesToLink, CallStatus: 'completed' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendCallLinkText).toHaveBeenCalledWith(7);
    });

    it('Twilio has its answer without waiting on the text', async () => {
      sendCallLinkText.mockReturnValue(new Promise<boolean>(() => undefined));
      const { app } = await on();
      const res = await fromTwilio(app, gather(LINK_STEP, 1), yesToLink);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Perfect. Check your SMS.');
    });

    it('no to the link, or any other answer: no text', async () => {
      const { app } = await on();
      await fromTwilio(app, gather(LINK_STEP, 1), { ...yesToLink, Digits: '2' });
      await fromTwilio(app, gather(OFFER_STEP, 1), { ...yesToLink, Digits: '1' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendCallLinkText).not.toHaveBeenCalled();
    });
  });

  it('"stop calling me", or 9: the number to be blocked, and goodbye', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, gather(OFFER_STEP, 1), said('Stop calling me'));
    expect(kept()).toMatchObject({ record: { result: 'opt_out' }, result: 'opted_out', blockNumber: true });
    expect(res.text).toContain("Okay, we will not call you again. Goodbye.</Say><Hangup/>");
  });

  it('silence: asked again, for keys, as the second try; silence again: no response, and the call ends', async () => {
    const { app } = await on();
    const first = await fromTwilio(app, gather(OFFER_STEP, 1), { CallSid: 'CA900', CallStatus: 'in-progress' });
    expect(first.text).toContain("Sorry, I did not catch that.</Say><Gather");
    expect(first.text).toContain('Press 1 for yes, 2 for no, or 9 to stop these calls.</Say></Gather>');
    expect(first.text).toContain(`step=${OFFER_STEP}&amp;try=2`);
    expect(first.text).not.toContain('<Pause');

    const second = await fromTwilio(app, gather(OFFER_STEP, 2), { CallSid: 'CA900', CallStatus: 'in-progress' });
    expect(keepAnswer.mock.calls[1][0]).toMatchObject({ attempt: 2, record: { result: 'silence' }, result: 'no_response' });
    expect(second.text).toMatch(/<Hangup\/><\/Response>$/);
  });

  it('a "yes" Twilio was unsure of is not trusted - the threshold is the setting\'s', async () => {
    readMinConfidence.mockResolvedValue(0.95);
    const { app } = await on();
    const res = await fromTwilio(app, gather(OFFER_STEP, 1), said('yes', '0.9'));
    expect(kept()).toMatchObject({ record: { result: 'unclear' }, result: null });
    expect(res.text).toContain("Sorry, I did not catch that.");
  });

  it('after a hang-up, with nothing said: nothing kept as an answer, and nothing said back', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, gather(OFFER_STEP, 1), { CallSid: 'CA900', CallStatus: 'completed' });
    expect(kept()).toMatchObject({ record: null, result: null, blockNumber: false });
    expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
  });

  it.each([
    ['no step', `/api/webhooks/twilio/auto/gather?call=42&try=1`],
    ['no try', `/api/webhooks/twilio/auto/gather?call=42&step=${OFFER_STEP}`],
    ['a third try', `/api/webhooks/twilio/auto/gather?call=42&step=${OFFER_STEP}&try=3`],
  ])('an address with %s: the call ends, nothing is kept', async (_, path) => {
    const { app } = await on();
    expect((await fromTwilio(app, path, said('yes'))).text).toMatch(/<Response><Hangup\/><\/Response>$/);
    expect(keepAnswer).not.toHaveBeenCalled();
  });

  it('the database failing: the call ends quietly', async () => {
    keepAnswer.mockRejectedValue(new Error('connection refused'));
    const { app } = await on();
    const res = await fromTwilio(app, gather(OFFER_STEP, 1), said('yes'));
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
  });
});

describe('how it ended', () => {
  const STATUS = '/api/webhooks/twilio/auto/status?call=42';

  it('is saved on the row, as every call\'s end is - answered, with its length - then the script given an end', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, STATUS, { CallSid: 'CA900', CallStatus: 'completed', CallDuration: '31' });
    expect(res.status).toBe(204);
    expect(linkAutomatedCall).toHaveBeenCalledWith(42, 'CA900');
    expect(finishCall).toHaveBeenCalledWith({ callSid: 'CA900', outcome: 'answered', durationSec: 31 });
    expect(settleAutomatedCall).toHaveBeenCalledWith(42);
    expect(finishCall.mock.invocationCallOrder[0]).toBeLessThan(settleAutomatedCall.mock.invocationCallOrder[0]);
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
