import twilio from 'twilio';
import type { TwilioSettings } from '../twilio-settings';
import { dialTwiml, isFromTwilio, mintCallToken, refusalTwiml, TOKEN_TTL_SECONDS } from './twilio';

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
  it('lets one agent place calls through our TwiML App, and receive none', () => {
    const { token, identity } = mintCallToken(SETTINGS, 21);
    const claims = payload(token);
    expect(identity).toBe('agent-21');
    expect(claims.iss).toBe(SETTINGS.apiKey);
    expect(claims.sub).toBe(SETTINGS.accountSid);
    expect(claims.grants.identity).toBe('agent-21');
    expect(claims.grants.voice.outgoing.application_sid).toBe(SETTINGS.twimlAppSid);
    expect(claims.grants.voice.incoming?.allow).not.toBe(true);
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
