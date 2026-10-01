/**
 * Browser calling's routes: the browser's two (config, token) and Twilio's two
 * (voice, status). The database layer is mocked; the route contract, Twilio's
 * signature check and the refusals are what is under test. The SQL is proved by
 * scripts/calls-live-check.ts.
 */
import request from 'supertest';
import twilio from 'twilio';
import type { TwilioSettings } from '../../twilio-settings';
import type { StartCallResult } from '../../db/calls';
import { buildApp, seedUser, signIn } from './helpers';

type StartArgs = Parameters<typeof import('../../db/calls').startCall>;
type FinishArgs = Parameters<typeof import('../../db/calls').finishCall>;
const startCall = jest.fn<Promise<StartCallResult>, StartArgs>();
const finishCall = jest.fn<Promise<boolean>, FinishArgs>();
jest.mock('../../db/calls', () => ({
  startCall: (...a: StartArgs) => startCall(...a),
  finishCall: (...a: FinishArgs) => finishCall(...a),
}));

// The raw archive writes through the pool; here it only has to be called.
const poolQuery = jest.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 1 }));
jest.mock('../../db/pool', () => ({ pool: { query: (...a: [string, unknown[]?]) => poolQuery(...a) } }));

beforeEach(() => {
  poolQuery.mockClear();
  startCall.mockReset().mockResolvedValue({ ok: true, phone: '+16026203572' });
  finishCall.mockReset().mockResolvedValue(true);
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
