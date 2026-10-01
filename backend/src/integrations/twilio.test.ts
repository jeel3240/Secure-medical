import twilio from 'twilio';
import type { TwilioSettings } from '../twilio-settings';
import {
  dialTwiml,
  emptyTwiml,
  isFromTwilio,
  mintCallToken,
  missedCallTwiml,
  refusalTwiml,
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
    const xml = dialTwiml(SETTINGS, '+16026203572');
    expect(xml).toContain('callerId="+14804708259"');
    expect(xml).toContain('answerOnBridge="true"');
    expect(xml).toContain('statusCallback="https://calls.example.com/api/webhooks/twilio/status"');
    expect(xml).toMatch(/<Number[^>]*>\+16026203572<\/Number>/);
  });

  it('a refusal says why, then hangs up', () => {
    expect(refusalTwiml('Pick up this lead first.')).toMatch(/<Say>Pick up this lead first\.<\/Say><Hangup\/>/);
  });
});

describe('a lead calling our number', () => {
  it('rings one agent’s browser for 20 seconds, saying who is calling', () => {
    const xml = ringAgentTwiml(SETTINGS, 21, { id: 7, name: 'Priya Sharma', phone: '+16026203572' });
    expect(xml).toContain('timeout="20"');
    expect(xml).toContain('<Identity>agent-21</Identity>');
    expect(xml).toContain('<Parameter name="leadId" value="7"/>');
    expect(xml).toContain('<Parameter name="leadName" value="Priya Sharma"/>');
    expect(xml).toContain('<Parameter name="leadPhone" value="+16026203572"/>');
    // Reported when it ends, and asked what to say if nobody picked up.
    expect(xml).toContain('statusCallback="https://calls.example.com/api/webhooks/twilio/status"');
    expect(xml).toContain('action="https://calls.example.com/api/webhooks/twilio/incoming/after"');
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
