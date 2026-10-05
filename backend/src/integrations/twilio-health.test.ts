import type { TwilioSettings } from '../twilio-settings';
import { callingCheck, type CallingSetup } from './twilio-health';

const SETTINGS: TwilioSettings = {
  accountSid: `AC${'1'.repeat(32)}`,
  authToken: 'f'.repeat(32),
  apiKey: `SK${'2'.repeat(32)}`,
  apiSecret: 'S'.repeat(32),
  twimlAppSid: `AP${'3'.repeat(32)}`,
  callerId: '+14804708259',
  publicUrl: 'https://dailyleadhub.com',
};

const HERE: CallingSetup = {
  reached: true,
  appVoiceUrl: 'https://dailyleadhub.com/api/webhooks/twilio/voice',
  numberFound: true,
  numberVoiceUrl: 'https://dailyleadhub.com/api/webhooks/twilio/incoming',
  numberApplicationSid: null,
};

describe('is calling still wired to this server', () => {
  it('ok when the TwiML App and the phone number both point here', () => {
    expect(callingCheck(SETTINGS, HERE)).toMatchObject({ name: 'calling', status: 'ok', message: null });
  });

  it('calling not set up is no verdict, not a fault', () => {
    expect(callingCheck(null, null)).toEqual({ name: 'calling', status: 'info', message: null, detail: { enabled: false } });
  });

  it('degraded when the phone number points at another deployment - incoming calls go there, silently', () => {
    const laptop = { ...HERE, numberVoiceUrl: 'https://some-tunnel.trycloudflare.com/api/webhooks/twilio/incoming' };
    const check = callingCheck(SETTINGS, laptop);
    expect(check.status).toBe('degraded');
    expect(check.message).toMatch(/Incoming calls are not reaching this server.*twilio:configure/);
    expect(check.detail.numberVoiceUrl).toBe(laptop.numberVoiceUrl);
  });

  it('degraded when the number has no Voice URL, or a TwiML App set over it', () => {
    expect(callingCheck(SETTINGS, { ...HERE, numberVoiceUrl: null }).status).toBe('degraded');
    expect(callingCheck(SETTINGS, { ...HERE, numberApplicationSid: `AP${'9'.repeat(32)}` }).status).toBe('degraded');
  });

  it('degraded when the TwiML App points elsewhere - calls agents place will fail', () => {
    const check = callingCheck(SETTINGS, { ...HERE, appVoiceUrl: 'https://old.example.com/api/webhooks/twilio/voice' });
    expect(check).toMatchObject({ status: 'degraded' });
    expect(check.message).toMatch(/Calls agents place will fail/);
  });

  it('degraded when the number is not on the account', () => {
    const check = callingCheck(SETTINGS, { ...HERE, numberFound: false, numberVoiceUrl: null });
    expect(check.message).toBe('+14804708259 is not a number on the Twilio account.');
  });

  it('degraded, and says so, when Twilio cannot be asked', () => {
    const check = callingCheck(SETTINGS, { reached: false, error: 'ECONNRESET' });
    expect(check).toMatchObject({ status: 'degraded', message: 'Twilio could not be reached to check the calling setup.' });
  });

  it('never puts a secret in the report', () => {
    const text = JSON.stringify(callingCheck(SETTINGS, HERE));
    expect(text).not.toContain(SETTINGS.authToken);
    expect(text).not.toContain(SETTINGS.apiSecret);
  });
});
