import twilio from 'twilio';
import type { TwilioSettings } from '../twilio-settings';
import {
  dialTwiml,
  emptyTwiml,
  isFromTwilio,
  mintCallToken,
  missedCallTwiml,
  refusalTwiml,
  recordingNoticeTwiml,
  ringAgentTwiml,
  TOKEN_TTL_SECONDS,
} from './twilio';

const SETTINGS: TwilioSettings = {
  accountSid: `AC${'1'.repeat(32)}`,
  authToken: 'f'.repeat(32),
  apiKey: `SK${'2'.repeat(32)}`,
  apiSecret: 'S'.repeat(32),
  twimlAppSid: `AP${'3'.repeat(32)}`,
  callerId: '+14804708259',
  publicUrl: 'https://calls.example.com',
};

const payload = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

describe('the browser call token', () => {
  it('lets one agent place calls through our TwiML App, and be rung as that agent', () => {
    const { token, identity } = mintCallToken(SETTINGS, 21);
    const claims = payload(token);
    expect(identity).toBe('agent-21');
    expect(claims.iss).toBe(SETTINGS.apiKey);
    expect(claims.sub).toBe(SETTINGS.accountSid);
    expect(claims.grants.identity).toBe('agent-21');
    expect(claims.grants.voice.outgoing.application_sid).toBe(SETTINGS.twimlAppSid);
    // Incoming: so a lead calling back can ring this agent's browser.
    expect(claims.grants.voice.incoming.allow).toBe(true);
    expect(claims.exp - claims.iat).toBe(TOKEN_TTL_SECONDS);
  });
});

describe('telling Twilio how to connect', () => {
  it('dials the lead from our number, rings until answered, and reports how it ended', () => {
    const xml = dialTwiml(SETTINGS, '+16026203572', 'CA100');
    expect(xml).toContain('callerId="+14804708259"');
    expect(xml).toContain('answerOnBridge="true"');
    expect(xml).toContain('statusCallback="https://calls.example.com/api/webhooks/twilio/status"');
    expect(xml).toMatch(/<Number[^>]*>\+16026203572<\/Number>/);
  });

  it('asks Twilio whether a person or a machine picks up, and to say which call it was', () => {
    const xml = dialTwiml(SETTINGS, '+16026203572', 'CA100');
    expect(xml).toContain('machineDetection="Enable"');
    expect(xml).toContain('amdStatusCallback="https://calls.example.com/api/webhooks/twilio/answered-by?call=CA100"');
    expect(xml).toContain('amdStatusCallbackMethod="POST"');
  });

  it('does not record without a transcription service', () => {
    expect(dialTwiml(SETTINGS, '+16026203572', 'CA100')).not.toContain('record=');
  });

  it('with one, records the call in two channels and says which call the recording is for', () => {
    const xml = dialTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, '+16026203572', 'CA100');
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain('recordingStatusCallback="https://calls.example.com/api/webhooks/twilio/recording?call=CA100"');
    expect(xml).toContain('recordingStatusCallbackEvent="completed"');
  });

  it('a recorded call we place tells the lead so before connecting them; an unrecorded one says nothing', () => {
    const recorded = dialTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, '+16026203572', 'CA100');
    expect(recorded).toContain('url="https://calls.example.com/api/webhooks/twilio/notice"');
    expect(dialTwiml(SETTINGS, '+16026203572', 'CA100')).not.toContain('/notice');
    expect(recordingNoticeTwiml()).toContain('<Say>This call may be recorded and transcribed for quality, training, and service purposes. By continuing, you consent to the recording and transcription.</Say>');
  });

  it('a refusal says why, then hangs up', () => {
    expect(refusalTwiml('Pick up this lead first.')).toMatch(/<Say>Pick up this lead first\.<\/Say><Hangup\/>/);
  });
});

describe('a lead calling our number', () => {
  it('rings one agent’s browser for 20 seconds, saying who is calling', () => {
    const xml = ringAgentTwiml(SETTINGS, 21, { id: 7, name: 'Priya Sharma', phone: '+16026203572' }, 'CA300');
    expect(xml).toContain('timeout="20"');
    expect(xml).toContain('<Identity>agent-21</Identity>');
    expect(xml).toContain('<Parameter name="leadId" value="7"/>');
    expect(xml).toContain('<Parameter name="leadName" value="Priya Sharma"/>');
    expect(xml).toContain('<Parameter name="leadPhone" value="+16026203572"/>');
    // Reported when it ends, and asked what to say if nobody picked up.
    expect(xml).toContain('statusCallback="https://calls.example.com/api/webhooks/twilio/status"');
    expect(xml).toContain('action="https://calls.example.com/api/webhooks/twilio/incoming/after"');
  });

  it('records an incoming call too, when there is a transcription service', () => {
    const lead = { id: 7, name: 'Priya Sharma', phone: '+16026203572' };
    const xml = ringAgentTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, 21, lead, 'CA300');
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain('/api/webhooks/twilio/recording?call=CA300');
    expect(ringAgentTwiml(SETTINGS, 21, lead, 'CA300')).not.toContain('record=');
  });

  it('a recorded incoming call: the lead hears the notice first, then the agent rings', () => {
    const lead = { id: 7, name: 'Priya Sharma', phone: '+16026203572' };
    const xml = ringAgentTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, 21, lead, 'CA300');
    expect(xml.indexOf('<Say>This call may be recorded')).toBeGreaterThan(-1);
    expect(xml.indexOf('<Say>This call may be recorded')).toBeLessThan(xml.indexOf('<Dial'));
    expect(ringAgentTwiml(SETTINGS, 21, lead, 'CA300')).not.toContain('<Say>');
  });

  it('unanswered, tells the lead we will call back and hangs up', () => {
    expect(missedCallTwiml()).toMatch(/<Say>.*will call you back.*<\/Say><Hangup\/>/);
  });

  it('answered and over, has nothing more to say', () => {
    expect(emptyTwiml()).toMatch(/<Response\s*\/>/);
  });
});

describe('checking a request came from Twilio', () => {
  const params = { CallSid: 'CA1', From: 'client:agent-21' };
  const path = '/api/webhooks/twilio/voice';
  const signature = twilio.getExpectedTwilioSignature(SETTINGS.authToken, SETTINGS.publicUrl + path, params);

  it('accepts Twilio’s signature over our public URL', () => {
    expect(isFromTwilio(SETTINGS, { signature, path, params })).toBe(true);
  });

  it('refuses no signature, a changed field, or another URL', () => {
    expect(isFromTwilio(SETTINGS, { signature: undefined, path, params })).toBe(false);
    expect(isFromTwilio(SETTINGS, { signature, path, params: { ...params, From: 'client:agent-1' } })).toBe(false);
    expect(isFromTwilio(SETTINGS, { signature, path: '/api/webhooks/twilio/status', params })).toBe(false);
  });
});
