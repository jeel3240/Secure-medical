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
const keepAnswer = jest.fn<Promise<{ kept: boolean; leadId: number | null; takenByVerdict: boolean }>, KeepArgs>();
type ActArgs = Parameters<typeof import('../../db/auto-calls').actOnVerdict>;
type Acted = Awaited<ReturnType<typeof import('../../db/auto-calls').actOnVerdict>>;
const actOnVerdict = jest.fn<Promise<Acted>, ActArgs>();
const takenByVerdict = jest.fn<Promise<boolean>, [number]>();
const settleAutomatedCall = jest.fn();
type Context = Awaited<ReturnType<typeof import('../../db/auto-calls').transferContext>>;
const transferContext = jest.fn<Promise<Context>, [number]>();
type Taken = Awaited<ReturnType<typeof import('../../db/auto-calls').takeTransfer>>;
const takeTransfer = jest.fn<Promise<Taken>, [number, number]>();
const missTransfer = jest.fn();
const holdCall = jest.fn<Promise<boolean>, unknown[]>();
type HoldState = Awaited<ReturnType<typeof import('../../db/auto-calls').holdState>>;
const holdState = jest.fn<Promise<HoldState>, unknown[]>();
jest.mock('../../db/auto-calls', () => ({
  linkAutomatedCall: (...a: [number, string]) => linkAutomatedCall(...a),
  keepAnswer: (...a: KeepArgs) => keepAnswer(...a),
  actOnVerdict: (...a: ActArgs) => actOnVerdict(...a),
  takenByVerdict: (callId: number) => takenByVerdict(callId),
  settleAutomatedCall: (...a: unknown[]) => settleAutomatedCall(...a),
  transferContext: (callId: number) => transferContext(callId),
  takeTransfer: (callId: number, agentId: number) => takeTransfer(callId, agentId),
  missTransfer: (...a: unknown[]) => missTransfer(...a),
  holdCall: (...a: unknown[]) => holdCall(...a),
  holdState: (...a: unknown[]) => holdState(...a),
}));
type Rings = Awaited<ReturnType<typeof import('../../integrations/twilio-calls').transferRings>>;
const transferRings = jest.fn<Promise<Rings>, unknown[]>();
const replaceCall = jest.fn<Promise<boolean>, [TwilioSettings, string, string]>();
jest.mock('../../integrations/twilio-calls', () => ({
  transferRings: (...a: unknown[]) => transferRings(...a),
  replaceCall: (...a: [TwilioSettings, string, string]) => replaceCall(...a),
}));
const freePeople = jest.fn<Promise<number[]>, unknown[]>();
const switchOffAfterMissedRing = jest.fn<Promise<boolean>, unknown[]>();
const someoneOnOrJustOffCall = jest.fn<Promise<boolean>, unknown[]>();
jest.mock('../../db/presence', () => ({
  freePeople: (...a: unknown[]) => freePeople(...a),
  switchOffAfterMissedRing: (...a: unknown[]) => switchOffAfterMissedRing(...a),
  someoneOnOrJustOffCall: (...a: unknown[]) => someoneOnOrJustOffCall(...a),
}));
const loadActiveCallScript = jest.fn<Promise<CallScript | null>, unknown[]>();
const readMinConfidence = jest.fn<Promise<number>, unknown[]>();
const readRingSeconds = jest.fn<Promise<number>, unknown[]>();
const readHoldMaxSeconds = jest.fn<Promise<number>, unknown[]>();
const readOfferRingSeconds = jest.fn<Promise<number>, unknown[]>();
jest.mock('../../db/call-script', () => ({
  loadActiveCallScript: (...a: unknown[]) => loadActiveCallScript(...a),
  readMinConfidence: (...a: unknown[]) => readMinConfidence(...a),
  readRingSeconds: (...a: unknown[]) => readRingSeconds(...a),
  readHoldMaxSeconds: (...a: unknown[]) => readHoldMaxSeconds(...a),
  readOfferRingSeconds: (...a: unknown[]) => readOfferRingSeconds(...a),
}));
const someoneComing = jest.fn<Promise<boolean>, unknown[]>();
type Live = Awaited<ReturnType<typeof import('../../db/hold-offers').liveOffer>>;
const liveOffer = jest.fn<Promise<Live>, unknown[]>();
const endOffer = jest.fn<Promise<number | null>, unknown[]>();
jest.mock('../../db/hold-offers', () => ({
  someoneComing: (...a: unknown[]) => someoneComing(...a),
  liveOffer: (...a: unknown[]) => liveOffer(...a),
  endOffer: (...a: unknown[]) => endOffer(...a),
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

/** Lets what a webhook does after Twilio has its answer finish - the link text, switches turned off. */
const afterResponse = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
afterEach(afterResponse);

beforeEach(() => {
  linkAutomatedCall.mockReset().mockResolvedValue(true);
  keepAnswer.mockReset().mockResolvedValue({ kept: true, leadId: 7, takenByVerdict: false });
  // Acts as the database would on a verdict it takes the call over for.
  actOnVerdict.mockReset().mockImplementation(async (_callId, verdict, takeOver) => {
    const action = verdict === 'fax' ? 'hang_up' : 'voicemail';
    return { action, tookOver: await takeOver(action, 'CA900') };
  });
  takenByVerdict.mockReset().mockResolvedValue(false);
  replaceCall.mockReset().mockResolvedValue(true);
  sendCallLinkText.mockReset().mockResolvedValue(true);
  settleAutomatedCall.mockReset().mockResolvedValue(undefined);
  transferContext.mockReset().mockResolvedValue({
    lead: { id: 7, name: 'Priya Sharma', phone: '+15550100016' },
    heldBy: null,
    yesStepId: OFFER_STEP,
  });
  takeTransfer.mockReset().mockResolvedValue({ ok: true, leadId: 7, tookOverFrom: null });
  missTransfer.mockReset().mockResolvedValue(undefined);
  freePeople.mockReset().mockResolvedValue([]);
  switchOffAfterMissedRing.mockReset().mockResolvedValue(true);
  someoneOnOrJustOffCall.mockReset().mockResolvedValue(false);
  holdCall.mockReset().mockResolvedValue(true);
  holdState.mockReset().mockResolvedValue(null);
  readHoldMaxSeconds.mockReset().mockResolvedValue(600);
  readOfferRingSeconds.mockReset().mockResolvedValue(20);
  someoneComing.mockReset().mockResolvedValue(false);
  liveOffer.mockReset().mockResolvedValue(null);
  endOffer.mockReset().mockResolvedValue(19);
  transferRings.mockReset().mockResolvedValue([]);
  readRingSeconds.mockReset().mockResolvedValue(25);
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

  it('"yes please" to the offer with nobody free: kept as Yes; the busy line, transfer_missed (T15a)', async () => {
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
      keepAnswer.mockResolvedValue({ kept: false, leadId: 7, takenByVerdict: false });
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

describe('the transfer (T15a)', () => {
  const yes = { CallSid: 'CA900', CallStatus: 'in-progress', SpeechResult: 'Yes please', Confidence: '0.9' };
  const GATHER = `/api/webhooks/twilio/auto/gather?call=42&step=${OFFER_STEP}&try=1`;
  const CLAIM = '/api/webhooks/twilio/auto/claim?call=42';
  const AFTER = '/api/webhooks/twilio/auto/after?call=42';

  it('accepting and the ringing ending are reached as the others are: never while off, only signed by Twilio', async () => {
    const accepted = { CallSid: 'CA-AGENT', ParentCallSid: 'CA900', To: 'client:dev-agent-16' };
    const ended = { CallSid: 'CA900', DialCallStatus: 'no-answer' };
    const { app: off } = await buildApp({ twilio: SETTINGS, autoCalls: false });
    expect((await fromTwilio(off, CLAIM, accepted)).status).toBe(404);
    expect((await fromTwilio(off, AFTER, ended)).status).toBe(404);
    const { app } = await on();
    expect((await request(app).post(CLAIM).type('form').send(accepted)).status).toBe(403);
    expect((await request(app).post(AFTER).type('form').send(ended)).status).toBe(403);
    expect(takeTransfer).not.toHaveBeenCalled();
    expect(missTransfer).not.toHaveBeenCalled();
    expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
  });

  it('a yes with people free: the line, then all of them rung together, as a transfer of a yes to the offer', async () => {
    freePeople.mockResolvedValue([16, 21]);
    const { app } = await on();
    const res = await fromTwilio(app, GATHER, yes);
    expect(keepAnswer.mock.calls[0][0]).toMatchObject({ record: { choiceLabel: 'Yes' }, result: null });
    expect(res.text).toContain('Please hold.</Say><Dial');
    expect(res.text).toContain('<Identity>dev-agent-16</Identity>');
    expect(res.text).toContain('<Identity>dev-agent-21</Identity>');
    expect(res.text).toContain('<Parameter name="step" value="Offer"/>');
    expect(res.text).toContain('<Parameter name="leadName" value="Priya Sharma"/>');
    expect(res.text).toContain('timeout="25"');
    expect(res.text).toContain(`auto/after?call=42&amp;step=${OFFER_STEP}&amp;rung=16%2C21"`);
  });

  describe('the lead\'s own agent first (T15b)', () => {
    const heldBy = (agentId: number) =>
      transferContext.mockResolvedValue({
        lead: { id: 7, name: 'Priya Sharma', phone: '+15550100016' },
        heldBy: agentId,
        yesStepId: OFFER_STEP,
      });

    it('free: they ring alone, and the end is told who, so the others are rung next', async () => {
      freePeople.mockResolvedValue([16, 21]);
      heldBy(21);
      const { app } = await on();
      const res = await fromTwilio(app, GATHER, yes);
      expect(res.text.match(/<Client /g)).toHaveLength(1);
      expect(res.text).toContain('<Identity>dev-agent-21</Identity>');
      expect(res.text).toContain(`auto/after?call=42&amp;step=${OFFER_STEP}&amp;holder=21"`);
    });

    it('not free: everyone free at once, nobody waited for', async () => {
      freePeople.mockResolvedValue([16, 30]);
      heldBy(21);
      const { app } = await on();
      const res = await fromTwilio(app, GATHER, yes);
      expect(res.text.match(/<Client /g)).toHaveLength(2);
      expect(res.text).not.toContain('holder=');
    });

    describe('they let it ring out', () => {
      const HOLDER_AFTER = `/api/webhooks/twilio/auto/after?call=42&step=${OFFER_STEP}&holder=21`;
      const rangOut = { CallSid: 'CA900', CallStatus: 'in-progress', DialCallStatus: 'no-answer' };

      it('everyone else free rings now - not them, nothing said, still a transfer of a yes to the offer', async () => {
        freePeople.mockResolvedValue([16, 21, 30]);
        const { app } = await on();
        const res = await fromTwilio(app, HOLDER_AFTER, rangOut);
        expect(res.text).toMatch(/<Response><Dial /);
        expect(res.text).not.toContain('dev-agent-21');
        expect(res.text).toContain('<Identity>dev-agent-16</Identity>');
        expect(res.text).toContain('<Identity>dev-agent-30</Identity>');
        expect(res.text).toContain('<Parameter name="step" value="Offer"/>');
        expect(res.text).toContain(`auto/after?call=42&amp;step=${OFFER_STEP}&amp;rung=16%2C30"`);
        expect(missTransfer).not.toHaveBeenCalled();
      });

      it('declined because they were busy - the same', async () => {
        freePeople.mockResolvedValue([16]);
        const { app } = await on();
        const res = await fromTwilio(app, HOLDER_AFTER, { ...rangOut, DialCallStatus: 'busy' });
        expect(res.text).toContain('<Identity>dev-agent-16</Identity>');
      });

      it('nobody else free: the busy line, transfer_missed', async () => {
        freePeople.mockResolvedValue([21]);
        const { app } = await on();
        const res = await fromTwilio(app, HOLDER_AFTER, rangOut);
        expect(missTransfer).toHaveBeenCalledWith(42);
        expect(res.text).toContain('All our agents are busy right now.');
        expect(res.text).not.toContain('<Dial');
      });

      it('the lead hung up while it rang: nobody else is rung - transfer_missed, so an agent calls back', async () => {
        freePeople.mockResolvedValue([16]);
        const { app } = await on();
        const res = await fromTwilio(app, HOLDER_AFTER, { ...rangOut, CallStatus: 'completed' });
        expect(freePeople).not.toHaveBeenCalled();
        expect(missTransfer).toHaveBeenCalledWith(42);
        expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
      });
    });
  });

  it('a yes after the voicemail message took the call (T18) rings nobody - it was the greeting, or the page replaced', async () => {
    freePeople.mockResolvedValue([16]);
    keepAnswer.mockResolvedValue({ kept: false, leadId: 7, takenByVerdict: true });
    const { app } = await on();
    const res = await fromTwilio(app, GATHER, yes);
    expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
    expect(holdCall).not.toHaveBeenCalled();
  });

  it('a yes said as the lead hung up rings nobody', async () => {
    freePeople.mockResolvedValue([16]);
    const { app } = await on();
    const res = await fromTwilio(app, GATHER, { ...yes, CallStatus: 'completed' });
    expect(freePeople).not.toHaveBeenCalled();
    expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
  });

  describe('a person accepts', () => {
    const accepted = { CallSid: 'CA-AGENT', ParentCallSid: 'CA900', To: 'client:dev-agent-16', CallStatus: 'in-progress' };

    it('the lead becomes theirs - on the automated call this leg belongs to - and they are connected', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, CLAIM, accepted);
      expect(linkAutomatedCall).toHaveBeenCalledWith(42, 'CA900');
      expect(takeTransfer).toHaveBeenCalledWith(42, 16);
      expect(res.text).toMatch(/<Response\/>$/);
    });

    it('refused - deactivated while it rang, or taken by another: their leg is hung up', async () => {
      takeTransfer.mockResolvedValue({ ok: false, reason: 'inactive' });
      const { app } = await on();
      expect((await fromTwilio(app, CLAIM, accepted)).text).toMatch(/<Hangup\/>/);
    });

    it('a leg of some other Twilio call takes nothing', async () => {
      linkAutomatedCall.mockResolvedValue(false);
      const { app } = await on();
      const res = await fromTwilio(app, CLAIM, { ...accepted, ParentCallSid: 'CA-OTHER' });
      expect(takeTransfer).not.toHaveBeenCalled();
      expect(res.text).toMatch(/<Hangup\/>/);
    });

    it('a browser not of this server - production\'s name on a laptop - takes nothing', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, CLAIM, { ...accepted, To: 'client:agent-16' });
      expect(takeTransfer).not.toHaveBeenCalled();
      expect(res.text).toMatch(/<Hangup\/>/);
    });

    it('the database failing still connects them - the lead is waiting for a person', async () => {
      takeTransfer.mockRejectedValue(new Error('connection refused'));
      const { app } = await on();
      const res = await fromTwilio(app, CLAIM, accepted);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<Response\/>$/);
    });
  });

  describe('the ringing ends', () => {
    it('taken, and they talked: nothing more to say, nothing saved here, nobody switched off', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, `${AFTER}&rung=16,19`, { CallSid: 'CA900', DialCallStatus: 'completed' });
      expect(res.text).toMatch(/<Response\/>$/);
      expect(missTransfer).not.toHaveBeenCalled();
      expect(transferRings).not.toHaveBeenCalled();
      expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
    });

    it.each(['no-answer', 'busy', 'failed', 'canceled'])('%s - nobody took it: transfer_missed, and the busy line', async (status) => {
      const { app } = await on();
      const res = await fromTwilio(app, AFTER, { CallSid: 'CA900', DialCallStatus: status });
      expect(missTransfer).toHaveBeenCalledWith(42);
      expect(res.text).toContain('All our agents are busy right now. An agent will call you back shortly.</Say><Hangup/>');
    });

    describe('who let it ring out has their switch turned off (T15c)', () => {
      const ranOut = { CallSid: 'CA900', CallStatus: 'in-progress', DialCallStatus: 'no-answer' };

      it('several rung: Twilio is asked how each ring ended - only those whose own ring ran out', async () => {
        const at = new Date('2026-10-20T23:46:20Z');
        transferRings.mockResolvedValue([
          { to: 'client:dev-agent-16', status: 'no-answer', startedAt: at },
          { to: 'client:dev-agent-19', status: 'busy', startedAt: at },
          { to: 'client:agent-30', status: 'no-answer', startedAt: at },
        ]);
        const { app } = await on();
        const res = await fromTwilio(app, `${AFTER}&step=${OFFER_STEP}&rung=16,19,30`, ranOut);
        expect(res.text).toContain('All our agents are busy right now.');
        await afterResponse();
        expect(transferRings).toHaveBeenCalledWith(SETTINGS, 'CA900');
        // 19 declined; 30 is rung here only as dev-agent-30, so production's agent-30 is not them.
        expect(switchOffAfterMissedRing.mock.calls.map((c) => [c[1], c[2]])).toEqual([[16, 42]]);
      });

      it('someone rung more than once on the call: their latest ring decides', async () => {
        transferRings.mockResolvedValue([
          { to: 'client:dev-agent-16', status: 'busy', startedAt: new Date('2026-10-20T23:46:20Z') },
          { to: 'client:dev-agent-16', status: 'no-answer', startedAt: new Date('2026-10-20T23:45:20Z') },
          { to: 'client:dev-agent-19', status: 'no-answer', startedAt: new Date('2026-10-20T23:46:20Z') },
        ]);
        const { app } = await on();
        await fromTwilio(app, `${AFTER}&step=${OFFER_STEP}&rung=16,19`, ranOut);
        await afterResponse();
        expect(switchOffAfterMissedRing.mock.calls.map((c) => c[1])).toEqual([19]);
      });

      it('the lead\'s own agent, rung alone, let it ring out: switched off - no need to ask Twilio', async () => {
        freePeople.mockResolvedValue([16]);
        const { app } = await on();
        await fromTwilio(app, `${AFTER}&step=${OFFER_STEP}&holder=21`, ranOut);
        await afterResponse();
        expect(transferRings).not.toHaveBeenCalled();
        expect(switchOffAfterMissedRing.mock.calls.map((c) => [c[1], c[2]])).toEqual([[21, 42]]);
      });

      it('they declined instead: not switched off', async () => {
        const { app } = await on();
        await fromTwilio(app, `${AFTER}&step=${OFFER_STEP}&holder=21`, { ...ranOut, DialCallStatus: 'busy' });
        await afterResponse();
        expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
      });

      it('the lead hung up while it rang: nobody - it was not left to run out', async () => {
        const { app } = await on();
        await fromTwilio(app, `${AFTER}&step=${OFFER_STEP}&rung=16,19`, { ...ranOut, CallStatus: 'completed' });
        await afterResponse();
        expect(transferRings).not.toHaveBeenCalled();
        expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
      });

      it('Twilio cannot be asked: nobody, and the lead still hears the busy line', async () => {
        transferRings.mockResolvedValue(null);
        const { app } = await on();
        const res = await fromTwilio(app, `${AFTER}&step=${OFFER_STEP}&rung=16,19`, ranOut);
        expect(res.text).toContain('All our agents are busy right now.');
        await afterResponse();
        expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
      });

      it('who was rung not in the address the server wrote: nobody', async () => {
        const { app } = await on();
        await fromTwilio(app, `${AFTER}&step=${OFFER_STEP}&rung=16;drop`, ranOut);
        await afterResponse();
        expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
      });
    });

    it('the lead hung up while it rang: transfer_missed, and nothing said to nobody', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, AFTER, { CallSid: 'CA900', CallStatus: 'completed', DialCallStatus: 'canceled' });
      expect(missTransfer).toHaveBeenCalledWith(42);
      expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
    });
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
    await afterResponse();
    expect(recordAnsweredBy).toHaveBeenCalledWith({ callSid: 'CA900', answeredBy: 'machine' });
  });

  it('a verdict it does not know is ignored', async () => {
    const { app } = await on();
    await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'robot' });
    await afterResponse();
    expect(recordAnsweredBy).not.toHaveBeenCalled();
    expect(actOnVerdict).not.toHaveBeenCalled();
  });

  describe('voicemail (T18)', () => {
    it('a beep heard: the message, in the script\'s voice, our number digit by digit, then the call ends', async () => {
      const { app } = await on();
      expect((await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'machine_end_beep' })).status).toBe(204);
      await afterResponse();
      expect(actOnVerdict.mock.calls[0].slice(0, 2)).toEqual([42, 'beep']);
      const [settings, callSid, twiml] = replaceCall.mock.calls[0];
      expect([settings, callSid]).toEqual([SETTINGS, 'CA900']);
      expect(twiml).toBe(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Google.en-US-Chirp3-HD-Kore">' +
          'Hi, this is Seri calling from eDrugstore with a quick message - we\'re offering antibiotics at 25% off right now. ' +
          'We\'d love to connect. Please call us back at 4 8 0, 5 3 0, 8 5 8 2. Thanks, and have a great day!</Say><Pause length="1"/><Hangup/></Response>'
      );
    });

    it('a machine with no beep heard is acted on too - the database decides with what the call has heard (onVerdict)', async () => {
      const { app } = await on();
      await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'machine_end_other' });
      await afterResponse();
      expect(actOnVerdict.mock.calls[0].slice(0, 2)).toEqual([42, 'machine']);
    });

    it('a fax: hung up on', async () => {
      const { app } = await on();
      await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'fax' });
      await afterResponse();
      expect(actOnVerdict.mock.calls[0].slice(0, 2)).toEqual([42, 'fax']);
      expect(replaceCall.mock.calls[0][2]).toMatch(/<Response><Hangup\/><\/Response>$/);
    });

    it('a person, or Twilio not sure: kept, and nothing else happens', async () => {
      const { app } = await on();
      for (const verdict of ['human', 'unknown']) {
        await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: verdict });
      }
      await afterResponse();
      expect(recordAnsweredBy).toHaveBeenCalledTimes(2);
      expect(actOnVerdict).not.toHaveBeenCalled();
    });

    it('a verdict already kept - Twilio sending it again: acted on once only', async () => {
      recordAnsweredBy.mockResolvedValue(false);
      const { app } = await on();
      await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'machine_end_beep' });
      await afterResponse();
      expect(actOnVerdict).not.toHaveBeenCalled();
    });

    it('Twilio has its answer first: the database failing after it changes nothing Twilio sees', async () => {
      actOnVerdict.mockRejectedValue(new Error('database down'));
      const { app } = await on();
      expect((await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'machine_end_beep' })).status).toBe(204);
      await afterResponse();
      expect(replaceCall).not.toHaveBeenCalled();
    });

    it('no script: nothing to say, nothing done', async () => {
      loadActiveCallScript.mockResolvedValue(null);
      const { app } = await on();
      await fromTwilio(app, AMD, { CallSid: 'CA900', AnsweredBy: 'machine_end_beep' });
      await afterResponse();
      expect(actOnVerdict).not.toHaveBeenCalled();
    });

    it('a row that is not this call: nothing kept, nothing done', async () => {
      linkAutomatedCall.mockResolvedValue(false);
      const { app } = await on();
      expect((await fromTwilio(app, AMD, { CallSid: 'CA999', AnsweredBy: 'machine_end_beep' })).status).toBe(204);
      await afterResponse();
      expect(recordAnsweredBy).not.toHaveBeenCalled();
      expect(actOnVerdict).not.toHaveBeenCalled();
    });

    it('a ring cut short by the message: nobody switched off, nothing more said', async () => {
      takenByVerdict.mockResolvedValue(true);
      const { app } = await on();
      const res = await fromTwilio(app, `/api/webhooks/twilio/auto/after?call=42&step=${OFFER_STEP}&rung=16%2C21`, {
        CallSid: 'CA900',
        CallStatus: 'in-progress',
        DialCallStatus: 'no-answer',
      });
      expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
      await afterResponse();
      expect(missTransfer).not.toHaveBeenCalled();
      expect(transferRings).not.toHaveBeenCalled();
      expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
    });
  });
});

describe('the hold line (T16)', () => {
  const yes = { CallSid: 'CA900', CallStatus: 'in-progress', SpeechResult: 'Yes please', Confidence: '0.9' };
  const GATHER = `/api/webhooks/twilio/auto/gather?call=42&step=${OFFER_STEP}&try=1`;
  const AFTER = `/api/webhooks/twilio/auto/after?call=42&step=${OFFER_STEP}`;
  const HOLD = '/api/webhooks/twilio/auto/hold?call=42';
  const live = { CallSid: 'CA900', CallStatus: 'in-progress' };
  const toHold = 'https://calls.example.com/api/webhooks/twilio/auto/hold?call=42';

  it('a yes with nobody free, while someone is on a call: the line, the hold line, then on hold - the answer kept first', async () => {
    someoneOnOrJustOffCall.mockResolvedValue(true);
    const { app } = await on();
    const res = await fromTwilio(app, GATHER, yes);
    expect(keepAnswer.mock.calls[0][0]).toMatchObject({ record: { choiceLabel: 'Yes' }, result: null });
    expect(res.text).toContain('Please hold.</Say><Say voice="Google.en-US-Chirp3-HD-Kore">All our agents are on other calls. Please stay on the line.</Say>');
    expect(res.text).toContain(`<Redirect method="POST">${toHold}</Redirect>`);
    expect(holdCall).toHaveBeenCalledWith(42);
    expect(keepAnswer.mock.invocationCallOrder[0]).toBeLessThan(holdCall.mock.invocationCallOrder[0]);
  });

  it('a yes with nobody free and nobody on a call: the busy line at once, as before', async () => {
    const { app } = await on();
    const res = await fromTwilio(app, GATHER, yes);
    expect(res.text).toContain('All our agents are busy right now.');
    expect(holdCall).not.toHaveBeenCalled();
  });

  it('the ring ran out, someone is on a call: on hold, not missed', async () => {
    someoneOnOrJustOffCall.mockResolvedValue(true);
    const { app } = await on();
    const res = await fromTwilio(app, `${AFTER}&rung=16,19`, { ...live, DialCallStatus: 'no-answer' });
    expect(res.text).toContain('All our agents are on other calls. Please stay on the line.');
    expect(res.text).toContain(`<Redirect method="POST">${toHold}</Redirect>`);
    expect(holdCall).toHaveBeenCalledWith(42);
    expect(missTransfer).not.toHaveBeenCalled();
  });

  it('the lead\'s own agent let it ring out, nobody else free, someone on a call: on hold', async () => {
    freePeople.mockResolvedValue([21]);
    someoneOnOrJustOffCall.mockResolvedValue(true);
    const { app } = await on();
    const res = await fromTwilio(app, `${AFTER}&holder=21`, { ...live, DialCallStatus: 'no-answer' });
    expect(res.text).toContain('Please stay on the line.');
    expect(holdCall).toHaveBeenCalledWith(42);
  });

  it('the lead hung up while it rang: never on hold', async () => {
    someoneOnOrJustOffCall.mockResolvedValue(true);
    const { app } = await on();
    await fromTwilio(app, `${AFTER}&rung=16,19`, { ...live, CallStatus: 'completed', DialCallStatus: 'no-answer' });
    expect(holdCall).not.toHaveBeenCalled();
    expect(missTransfer).toHaveBeenCalledWith(42);
  });

  describe('waiting', () => {
    it('first in line: "You are next.", a track of Twilio\'s hold music, then back here', async () => {
      someoneComing.mockResolvedValue(true);
      holdState.mockResolvedValue({ waitedSeconds: 5, place: 1 });
      const { app } = await on();
      const res = await fromTwilio(app, HOLD, live);
      expect(res.text).toContain('>You are next.</Say><Play>https://s3.amazonaws.com/com.twilio.music.classical/');
      expect(res.text).toMatch(new RegExp(`</Play><Redirect method="POST">${toHold.replace(/[?]/g, '\\?')}</Redirect></Response>$`));
      expect(missTransfer).not.toHaveBeenCalled();
    });

    it('further back: "You are number 2 in line."', async () => {
      someoneComing.mockResolvedValue(true);
      holdState.mockResolvedValue({ waitedSeconds: 400, place: 2 });
      const { app } = await on();
      expect((await fromTwilio(app, HOLD, live)).text).toContain('>You are number 2 in line.</Say>');
    });

    it('nobody coming any more - nobody on a call, nobody free who has not had them: the busy line, transfer_missed', async () => {
      holdState.mockResolvedValue({ waitedSeconds: 90, place: 1 });
      const { app } = await on();
      const res = await fromTwilio(app, HOLD, live);
      expect(res.text).toContain('All our agents are busy right now. An agent will call you back shortly.</Say><Hangup/>');
      expect(missTransfer).toHaveBeenCalledWith(42);
    });

    it('waited the safety stop\'s length: the busy line, though someone may still come', async () => {
      someoneComing.mockResolvedValue(true);
      readHoldMaxSeconds.mockResolvedValue(300);
      holdState.mockResolvedValue({ waitedSeconds: 300, place: 1 });
      const { app } = await on();
      expect((await fromTwilio(app, HOLD, live)).text).toContain('All our agents are busy right now.');
      expect(missTransfer).toHaveBeenCalledWith(42);
    });

    it('no longer on hold - sent here twice at once: the busy line again, never music', async () => {
      someoneComing.mockResolvedValue(true);
      const { app } = await on();
      const res = await fromTwilio(app, HOLD, live);
      expect(res.text).toContain('All our agents are busy right now.');
      expect(res.text).not.toContain('<Play>');
    });

    it('the lead has hung up: nothing said, nothing changed - the call\'s end settles it', async () => {
      holdState.mockResolvedValue({ waitedSeconds: 90, place: 1 });
      const { app } = await on();
      const res = await fromTwilio(app, HOLD, { ...live, CallStatus: 'completed' });
      expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
      expect(missTransfer).not.toHaveBeenCalled();
    });

    it('reached as the others are: never while off, only signed by Twilio', async () => {
      const { app: off } = await buildApp({ twilio: SETTINGS, autoCalls: false });
      expect((await fromTwilio(off, HOLD, live)).status).toBe(404);
      const { app } = await on();
      expect((await request(app).post(HOLD).type('form').send(live)).status).toBe(403);
      expect(holdState).not.toHaveBeenCalled();
    });
  });
});

describe('a lead on hold offered to whoever came free (T17)', () => {
  const OFFER = '/api/webhooks/twilio/auto/offer?call=42&offer=7';
  const HOLD = '/api/webhooks/twilio/auto/hold?call=42';
  const AFTER = `/api/webhooks/twilio/auto/after?call=42&step=${OFFER_STEP}&offer=7`;
  const live = { CallSid: 'CA900', CallStatus: 'in-progress' };
  const toHold = 'https://calls.example.com/api/webhooks/twilio/auto/hold?call=42';

  describe('the ring', () => {
    it('rings only the person the offer names, for the offer\'s ring time, as a transfer of the lead\'s yes', async () => {
      liveOffer.mockResolvedValue({ offerId: 7, agentId: 19 });
      const { app } = await on();
      const res = await fromTwilio(app, OFFER, live);
      expect(liveOffer).toHaveBeenCalledWith(42, 7);
      expect(res.text).toMatch(/<Response><Dial timeout="20"/);
      expect(res.text.match(/<Client /g)).toHaveLength(1);
      expect(res.text).toContain('<Identity>dev-agent-19</Identity>');
      expect(res.text).toContain('<Parameter name="step" value="Offer"/>');
      expect(res.text).toContain('<Parameter name="ring" value="group"/>');
      expect(res.text).toContain(`auto/after?call=42&amp;step=${OFFER_STEP}&amp;offer=7"`);
      // The music stops and it rings: nothing said, no notice again.
      expect(res.text).not.toContain('<Say');
    });

    it('the offer gone - ended, or never heard back: back on hold, where it is decided again', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, OFFER, live);
      expect(res.text).toContain(`<Redirect method="POST">${toHold}</Redirect>`);
      expect(res.text).not.toContain('<Dial');
    });

    it('the lead hung up as the music was cut: the offer ended hung_up, nothing rung', async () => {
      liveOffer.mockResolvedValue({ offerId: 7, agentId: 19 });
      const { app } = await on();
      const res = await fromTwilio(app, OFFER, { ...live, CallStatus: 'completed' });
      expect(endOffer).toHaveBeenCalledWith(42, 7, 'hung_up');
      expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
      expect(liveOffer).not.toHaveBeenCalled();
    });

    it('a call that is not ours to ring: the offer ended unsent, back on hold', async () => {
      liveOffer.mockResolvedValue({ offerId: 7, agentId: 19 });
      transferContext.mockResolvedValue(null);
      const { app } = await on();
      const res = await fromTwilio(app, OFFER, live);
      expect(endOffer).toHaveBeenCalledWith(42, 7, 'unsent');
      expect(res.text).toContain(`<Redirect method="POST">${toHold}</Redirect>`);
    });

    it('reached as the others are: never while off, only signed by Twilio', async () => {
      const { app: off } = await buildApp({ twilio: SETTINGS, autoCalls: false });
      expect((await fromTwilio(off, OFFER, live)).status).toBe(404);
      const { app } = await on();
      expect((await request(app).post(OFFER).type('form').send(live)).status).toBe(403);
      expect(liveOffer).not.toHaveBeenCalled();
    });
  });

  it('the music page\'s own request as the music is cut for the ring: the same ring, nothing changed', async () => {
    holdState.mockResolvedValue({ waitedSeconds: 90, place: 1 });
    liveOffer.mockResolvedValue({ offerId: 7, agentId: 19 });
    const { app } = await on();
    const res = await fromTwilio(app, HOLD, live);
    expect(res.text).toContain('<Identity>dev-agent-19</Identity>');
    expect(missTransfer).not.toHaveBeenCalled();
    expect(someoneComing).not.toHaveBeenCalled();
  });

  describe('not taken', () => {
    it('rang out: the offer ended missed, back on hold, and their switch off - no need to ask Twilio', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, AFTER, { ...live, DialCallStatus: 'no-answer' });
      expect(endOffer).toHaveBeenCalledWith(42, 7, 'missed');
      expect(res.text).toContain(`<Redirect method="POST">${toHold}</Redirect>`);
      expect(missTransfer).not.toHaveBeenCalled();
      expect(holdCall).not.toHaveBeenCalled();
      await afterResponse();
      expect(transferRings).not.toHaveBeenCalled();
      expect(switchOffAfterMissedRing.mock.calls.map((c) => [c[1], c[2]])).toEqual([[19, 42]]);
    });

    it('declined: ended declined, back on hold, the switch left on', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, AFTER, { ...live, DialCallStatus: 'busy' });
      expect(endOffer).toHaveBeenCalledWith(42, 7, 'declined');
      expect(res.text).toContain(`<Redirect method="POST">${toHold}</Redirect>`);
      await afterResponse();
      expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
    });

    it('the ring never completed - Twilio failed or cancelled it: ended failed, not declined, the switch left on', async () => {
      const { app } = await on();
      for (const status of ['failed', 'canceled']) {
        endOffer.mockClear();
        const res = await fromTwilio(app, AFTER, { ...live, DialCallStatus: status });
        expect(endOffer).toHaveBeenCalledWith(42, 7, 'failed');
        expect(res.text).toContain(`<Redirect method="POST">${toHold}</Redirect>`);
      }
      await afterResponse();
      expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
    });

    it('the lead hung up while it rang: ended hung_up, transfer_missed - an agent calls back', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, AFTER, { ...live, CallStatus: 'completed', DialCallStatus: 'no-answer' });
      expect(endOffer).toHaveBeenCalledWith(42, 7, 'hung_up');
      expect(missTransfer).toHaveBeenCalledWith(42);
      expect(res.text).toMatch(/<Response><Hangup\/><\/Response>$/);
      await afterResponse();
      expect(switchOffAfterMissedRing).not.toHaveBeenCalled();
    });

    it('taken: nothing more here - the claim ended the offer', async () => {
      const { app } = await on();
      const res = await fromTwilio(app, AFTER, { ...live, DialCallStatus: 'completed' });
      expect(res.text).toMatch(/<Response\/>$/);
      expect(endOffer).not.toHaveBeenCalled();
    });
  });

  it('a yes put on hold before any ring hears the recording notice - whoever takes them later is recorded', async () => {
    someoneOnOrJustOffCall.mockResolvedValue(true);
    const { app } = await buildApp({ twilio: { ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, autoCalls: true });
    const res = await fromTwilio(app, `/api/webhooks/twilio/auto/gather?call=42&step=${OFFER_STEP}&try=1`, {
      ...live,
      SpeechResult: 'Yes please',
      Confidence: '0.9',
    });
    expect(res.text).toContain('Please stay on the line.</Say><Say voice="Google.en-US-Chirp3-HD-Kore">This call may be recorded');
  });
});
