/**
 * Browser calling's routes: the browser's two (config, token) and Twilio's two
 * (voice, status). The database layer is mocked; the route contract, Twilio's
 * signature check and the refusals are what is under test. The SQL is proved by
 * scripts/calls-live-check.ts.
 */
import request from 'supertest';
import twilio from 'twilio';
import type { TwilioSettings } from '../../twilio-settings';
import type { FinishedCall, IncomingCall, StartCallResult } from '../../db/calls';
import { buildApp, seedUser, signIn } from './helpers';

type StartArgs = Parameters<typeof import('../../db/calls').startCall>;
type FinishArgs = Parameters<typeof import('../../db/calls').finishCall>;
const startCall = jest.fn<Promise<StartCallResult>, StartArgs>();
type IncomingArgs = Parameters<typeof import('../../db/calls').startIncomingCall>;
const finishCall = jest.fn<Promise<FinishedCall>, FinishArgs>();
const startIncomingCall = jest.fn<Promise<IncomingCall>, IncomingArgs>();
type AnsweredArgs = Parameters<typeof import('../../db/calls').recordAnsweredBy>;
const recordAnsweredBy = jest.fn<Promise<boolean>, AnsweredArgs>();
jest.mock('../../db/calls', () => ({
  startCall: (...a: StartArgs) => startCall(...a),
  finishCall: (...a: FinishArgs) => finishCall(...a),
  startIncomingCall: (...a: IncomingArgs) => startIncomingCall(...a),
  recordAnsweredBy: (...a: AnsweredArgs) => recordAnsweredBy(...a),
}));

type RecordingArgs = Parameters<typeof import('../../db/transcripts').saveRecording>;
const saveRecording = jest.fn<Promise<boolean>, RecordingArgs>();
jest.mock('../../db/transcripts', () => ({ saveRecording: (...a: RecordingArgs) => saveRecording(...a) }));

const sendMissedCallText = jest.fn<Promise<boolean>, [number]>();
jest.mock('../../db/missed-call-text', () => ({
  sendMissedCallText: (leadId: number) => sendMissedCallText(leadId),
}));

// The raw archive writes through the pool; here it only has to be called.
const poolQuery = jest.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 1 }));
jest.mock('../../db/pool', () => ({ pool: { query: (...a: [string, unknown[]?]) => poolQuery(...a) } }));

beforeEach(() => {
  poolQuery.mockClear();
  startCall.mockReset().mockResolvedValue({ ok: true, phone: '+16026203572' });
  finishCall.mockReset().mockResolvedValue({ recorded: true, missedLeadId: null });
  startIncomingCall.mockReset().mockResolvedValue({ kind: 'unknown' });
  recordAnsweredBy.mockReset().mockResolvedValue(true);
  saveRecording.mockReset().mockResolvedValue(true);
  sendMissedCallText.mockReset().mockResolvedValue(true);
});

const SETTINGS: TwilioSettings = {
  accountSid: `AC${'1'.repeat(32)}`,
  authToken: 'f'.repeat(32),
  apiKey: `SK${'2'.repeat(32)}`,
  apiSecret: 'S'.repeat(32),
  twimlAppSid: `AP${'3'.repeat(32)}`,
  callerId: '+14804708259',
  publicUrl: 'https://calls.example.com',
};
const PASSWORD = 'correct-horse-battery';

/** Posts form fields the way Twilio does, signed against our public URL unless told otherwise. */
function fromTwilio(app: string, path: string, params: Record<string, string>, signWith = SETTINGS.authToken) {
  const signature = twilio.getExpectedTwilioSignature(signWith, SETTINGS.publicUrl + path, params);
  return request(app).post(path).type('form').set('X-Twilio-Signature', signature).send(params);
}

const VOICE = '/api/webhooks/twilio/voice';
const STATUS = '/api/webhooks/twilio/status';
const A_CALL = { CallSid: 'CA100', From: 'client:agent-21', leadId: '7' };

describe('the browser’s routes', () => {
  async function setup(twilioSettings: TwilioSettings | null) {
    const { app, users } = await buildApp({ twilio: twilioSettings });
    await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
    return { app, maya: await signIn(app, 'maya@example.com', PASSWORD) };
  }

  it('need a session', async () => {
    const { app } = await setup(SETTINGS);
    expect((await request(app).get('/api/calls/config')).status).toBe(401);
    expect((await request(app).post('/api/calls/token')).status).toBe(401);
  });

  it('say calling is off, and refuse a token, when it is not set up', async () => {
    const { maya } = await setup(null);
    expect((await maya.get('/api/calls/config')).body).toEqual({ enabled: false, callerId: null });
    const res = await maya.post('/api/calls/token');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('calling_off');
  });

  it('give the caller ID and a token for the signed-in agent when it is', async () => {
    const { maya } = await setup(SETTINGS);
    expect((await maya.get('/api/calls/config')).body).toEqual({ enabled: true, callerId: '+14804708259' });
    const res = await maya.post('/api/calls/token');
    expect(res.status).toBe(200);
    expect(res.body.identity).toMatch(/^agent-\d+$/);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.ttlSeconds).toBe(3600);
  });
});

describe('Twilio’s webhooks are only Twilio’s', () => {
  it('do not exist when calling is not set up', async () => {
    const { app } = await buildApp();
    expect((await fromTwilio(app, VOICE, A_CALL)).status).toBe(404);
  });

  it('refuse an unsigned or wrongly signed request before touching the database', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    expect((await request(app).post(VOICE).type('form').send(A_CALL)).status).toBe(403);
    expect((await fromTwilio(app, VOICE, A_CALL, '0'.repeat(32))).status).toBe(403);
    expect(startCall).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('keep a signed request exactly as it arrived, in the raw archive', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    await fromTwilio(app, VOICE, A_CALL);
    const [sql, values] = poolQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO webhook_events/);
    expect(values).toEqual(['twilio', VOICE, JSON.stringify(A_CALL)]);
  });

  it('still connect the call when the archive cannot be written', async () => {
    poolQuery.mockRejectedValueOnce(new Error('disk full'));
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, VOICE, A_CALL);
    expect(res.text).toContain('<Dial');
  });
});

describe('connecting a call', () => {
  it('records the call and dials the lead from our number', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, VOICE, A_CALL);
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/xml');
    expect(res.text).toContain('callerId="+14804708259"');
    expect(res.text).toMatch(/<Number[^>]*>\+16026203572<\/Number>/);
    expect(startCall).toHaveBeenCalledWith({ callSid: 'CA100', leadId: 7, agentId: 21 });
    // Twilio is asked who picks up, and told which call to report it against.
    expect(res.text).toContain('amdStatusCallback="https://calls.example.com/api/webhooks/twilio/answered-by?call=CA100"');
  });

  it.each([
    ['not_holder', 'Pick up this lead'],
    ['blocked', 'do not call list'],
    ['not_found', 'could not be found'],
  ] as const)('refused as %s: says why and hangs up, dialling nobody', async (reason, words) => {
    startCall.mockResolvedValue({ ok: false, reason });
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, VOICE, A_CALL);
    expect(res.text).toContain(words);
    expect(res.text).toContain('<Hangup/>');
    expect(res.text).not.toContain('<Dial');
  });

  it.each([
    ['no agent identity', { ...A_CALL, From: '+16026203572' }],
    ['no lead', { ...A_CALL, leadId: '' }],
    ['no call id', { ...A_CALL, CallSid: '' }],
  ])('a request with %s is refused without a database lookup', async (_, params) => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, VOICE, params);
    expect(res.text).toContain('<Hangup/>');
    expect(startCall).not.toHaveBeenCalled();
  });

  it('a database failure is a sentence the agent hears, not Twilio’s error', async () => {
    startCall.mockRejectedValue(new Error('connection refused'));
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, VOICE, A_CALL);
    expect(res.status).toBe(200);
    expect(res.text).toContain('could not be placed');
  });
});

describe('recording how a call ended', () => {
  it('saves the outcome and talk time against the browser’s call', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, STATUS, {
      CallSid: 'CA200',
      ParentCallSid: 'CA100',
      CallStatus: 'completed',
      CallDuration: '134',
    });
    expect(res.status).toBe(204);
    expect(finishCall).toHaveBeenCalledWith({ callSid: 'CA100', outcome: 'answered', durationSec: 134 });
  });

  it('a call nobody answered has no talk time', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    await fromTwilio(app, STATUS, { ParentCallSid: 'CA100', CallStatus: 'no-answer', CallDuration: '0' });
    expect(finishCall).toHaveBeenCalledWith({ callSid: 'CA100', outcome: 'no_answer', durationSec: 0 });
  });

  it('ignores a status that is not an ending', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, STATUS, { ParentCallSid: 'CA100', CallStatus: 'ringing' });
    expect(res.status).toBe(204);
    expect(finishCall).not.toHaveBeenCalled();
  });
});

describe('who picked up a call we placed', () => {
  const ANSWERED_BY = '/api/webhooks/twilio/answered-by?call=CA100';

  it.each([
    ['machine_start', 'machine'],
    ['human', 'human'],
    ['fax', 'fax'],
    ['unknown', 'unknown'],
  ])('Twilio says %s: saved against the call named in the URL', async (raw, verdict) => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, ANSWERED_BY, { CallSid: 'CA200', AnsweredBy: raw });
    expect(res.status).toBe(204);
    // CA100, the browser's leg our row is keyed by - not CA200, the lead's leg the report is made on.
    expect(recordAnsweredBy).toHaveBeenCalledWith({ callSid: 'CA100', answeredBy: verdict });
  });

  it('a verdict we do not know, or no call named, records nothing and still answers 204', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    expect((await fromTwilio(app, ANSWERED_BY, { CallSid: 'CA200', AnsweredBy: 'robot' })).status).toBe(204);
    const bare = '/api/webhooks/twilio/answered-by';
    expect((await fromTwilio(app, bare, { CallSid: 'CA200', AnsweredBy: 'human' })).status).toBe(204);
    expect(recordAnsweredBy).not.toHaveBeenCalled();
  });

  it('is refused unsigned - and signed for another call, since the call is in the signed URL', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const params = { CallSid: 'CA200', AnsweredBy: 'machine_start' };
    expect((await request(app).post(ANSWERED_BY).type('form').send(params)).status).toBe(403);
    const forOther = twilio.getExpectedTwilioSignature(
      SETTINGS.authToken,
      `${SETTINGS.publicUrl}/api/webhooks/twilio/answered-by?call=CA999`,
      params
    );
    const res = await request(app).post(ANSWERED_BY).type('form').set('X-Twilio-Signature', forOther).send(params);
    expect(res.status).toBe(403);
    expect(recordAnsweredBy).not.toHaveBeenCalled();
  });
});

describe('the recording notice', () => {
  it('is what Twilio plays to a lead we called, and only Twilio can ask for it', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, '/api/webhooks/twilio/notice', { CallSid: 'CA200' });
    expect(res.type).toBe('text/xml');
    expect(res.text).toContain('This call may be recorded and transcribed');
    expect((await request(app).post('/api/webhooks/twilio/notice').type('form').send({})).status).toBe(403);
  });
});

describe('a call\'s recording is ready', () => {
  const RECORDING = '/api/webhooks/twilio/recording?call=CA100';
  const DONE = { RecordingSid: `RE${'5'.repeat(32)}`, RecordingStatus: 'completed', RecordingDuration: '42', RecordingChannels: '2' };

  it('is kept against the call named in the URL, for its transcript', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, RECORDING, DONE);
    expect(res.status).toBe(204);
    expect(saveRecording).toHaveBeenCalledWith({ callSid: 'CA100', recordingSid: DONE.RecordingSid, durationSec: 42, channels: 2 });
  });

  it('only once it is complete, and only with a call named', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    await fromTwilio(app, RECORDING, { ...DONE, RecordingStatus: 'in-progress' });
    await fromTwilio(app, '/api/webhooks/twilio/recording', DONE);
    expect(saveRecording).not.toHaveBeenCalled();
  });

  it('is refused unsigned', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    expect((await request(app).post(RECORDING).type('form').send(DONE)).status).toBe(403);
    expect(saveRecording).not.toHaveBeenCalled();
  });
});

describe('a lead calling our number', () => {
  const INCOMING = '/api/webhooks/twilio/incoming';
  const AFTER = '/api/webhooks/twilio/incoming/after';
  const A_RING = { CallSid: 'CA300', From: '+16026203572', To: '+14804708259' };

  it('rings the lead’s agent, saying who is calling', async () => {
    startIncomingCall.mockResolvedValue({
      kind: 'ring',
      agentId: 21,
      lead: { id: 7, name: 'Priya Sharma', phone: '+16026203572' },
    });
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, INCOMING, A_RING);

    expect(res.type).toBe('text/xml');
    expect(res.text).toContain('<Identity>agent-21</Identity>');
    expect(res.text).toContain('<Parameter name="leadId" value="7"/>');
    expect(startIncomingCall).toHaveBeenCalledWith({ callSid: 'CA300', fromPhone: '+16026203572' });
    expect(sendMissedCallText).not.toHaveBeenCalled();
  });

  it('with no agent to ring: says we will call back, and texts the lead', async () => {
    startIncomingCall.mockResolvedValue({ kind: 'missed', leadId: 7, firstReport: true });
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, INCOMING, A_RING);

    expect(res.text).toContain('will call you back');
    expect(res.text).not.toContain('<Dial');
    expect(sendMissedCallText).toHaveBeenCalledWith(7);
  });

  it('a retried webhook does not text the lead a second time', async () => {
    startIncomingCall.mockResolvedValue({ kind: 'missed', leadId: 7, firstReport: false });
    const { app } = await buildApp({ twilio: SETTINGS });
    await fromTwilio(app, INCOMING, A_RING);
    expect(sendMissedCallText).not.toHaveBeenCalled();
  });

  it('from a number we hold no lead for: the message, and no text', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, INCOMING, A_RING);
    expect(res.text).toContain('will call you back');
    expect(sendMissedCallText).not.toHaveBeenCalled();
  });

  it('a database failure is still the message, not Twilio’s error', async () => {
    startIncomingCall.mockRejectedValue(new Error('connection refused'));
    const { app } = await buildApp({ twilio: SETTINGS });
    const res = await fromTwilio(app, INCOMING, A_RING);
    expect(res.status).toBe(200);
    expect(res.text).toContain('will call you back');
  });

  it('is refused unsigned, like every Twilio webhook', async () => {
    const { app } = await buildApp({ twilio: SETTINGS });
    expect((await request(app).post(INCOMING).type('form').send(A_RING)).status).toBe(403);
    expect(startIncomingCall).not.toHaveBeenCalled();
  });

  describe('once ringing the agent is over', () => {
    it.each(['no-answer', 'busy', 'failed', 'canceled'])('%s: the lead hears that we will call back', async (status) => {
      const { app } = await buildApp({ twilio: SETTINGS });
      const res = await fromTwilio(app, AFTER, { CallSid: 'CA300', DialCallStatus: status });
      expect(res.text).toContain('will call you back');
    });

    it('records the missed call itself - an agent with no browser open sends no report of their own', async () => {
      finishCall.mockResolvedValue({ recorded: true, missedLeadId: 7 });
      const { app } = await buildApp({ twilio: SETTINGS });
      await fromTwilio(app, AFTER, { CallSid: 'CA300', DialCallStatus: 'no-answer' });
      expect(finishCall).toHaveBeenCalledWith({ callSid: 'CA300', outcome: 'no_answer', durationSec: 0 });
      expect(sendMissedCallText).toHaveBeenCalledWith(7);
    });

    it('the lead still hears the message when that record fails', async () => {
      finishCall.mockRejectedValue(new Error('connection refused'));
      const { app } = await buildApp({ twilio: SETTINGS });
      const res = await fromTwilio(app, AFTER, { CallSid: 'CA300', DialCallStatus: 'no-answer' });
      expect(res.status).toBe(200);
      expect(res.text).toContain('will call you back');
    });

    it('answered: nothing more is said', async () => {
      const { app } = await buildApp({ twilio: SETTINGS });
      const res = await fromTwilio(app, AFTER, { CallSid: 'CA300', DialCallStatus: 'completed' });
      expect(res.text).not.toContain('<Say>');
      expect(finishCall).not.toHaveBeenCalled();
    });
  });

  describe('the end-of-call report', () => {
    it('for a call nobody answered: texts the lead that we will call back', async () => {
      finishCall.mockResolvedValue({ recorded: true, missedLeadId: 7 });
      const { app } = await buildApp({ twilio: SETTINGS });
      const res = await fromTwilio(app, STATUS, { ParentCallSid: 'CA300', CallStatus: 'no-answer', CallDuration: '0' });
      expect(res.status).toBe(204);
      expect(sendMissedCallText).toHaveBeenCalledWith(7);
    });

    it('for an answered call, or a repeat report: sends nothing', async () => {
      const { app } = await buildApp({ twilio: SETTINGS });
      await fromTwilio(app, STATUS, { ParentCallSid: 'CA300', CallStatus: 'completed', CallDuration: '30' });
      finishCall.mockResolvedValue({ recorded: false, missedLeadId: null });
      await fromTwilio(app, STATUS, { ParentCallSid: 'CA300', CallStatus: 'no-answer', CallDuration: '0' });
      expect(sendMissedCallText).not.toHaveBeenCalled();
    });
  });
});
