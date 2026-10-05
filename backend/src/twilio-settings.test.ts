import { readTwilioSettings } from './twilio-settings';

const hex = (n: number) => 'a'.repeat(n);
const FULL = {
  TWILIO_ACCOUNT_SID: `AC${hex(32)}`,
  TWILIO_AUTH_TOKEN: hex(32),
  TWILIO_API_KEY: `SK${hex(32)}`,
  TWILIO_API_SECRET: 'Abc123'.padEnd(32, 'x'),
  TWILIO_TWIML_APP_SID: `AP${hex(32)}`,
  TWILIO_PHONE_NUMBER: '+14804708259',
  PUBLIC_URL: 'https://calls.example.com/',
};

describe('browser calling settings', () => {
  it('are off when no Twilio variable is set, even with PUBLIC_URL', () => {
    expect(readTwilioSettings({})).toEqual({ status: 'off' });
    expect(readTwilioSettings({ PUBLIC_URL: FULL.PUBLIC_URL, TWILIO_ACCOUNT_SID: '  ' })).toEqual({ status: 'off' });
  });

  it('are on with every one set, the public URL without its trailing slash', () => {
    const result = readTwilioSettings(FULL);
    expect(result.status).toBe('on');
    if (result.status === 'on') {
      expect(result.settings.publicUrl).toBe('https://calls.example.com');
      expect(result.settings.callerId).toBe('+14804708259');
    }
  });

  it('name what is missing when only some are set', () => {
    const { TWILIO_API_SECRET: _secret, PUBLIC_URL: _url, ...partial } = FULL;
    expect(readTwilioSettings(partial)).toEqual({
      status: 'incomplete',
      missing: ['TWILIO_API_SECRET', 'PUBLIC_URL'],
    });
  });

  it.each([
    ['an account SID where the API key goes', { TWILIO_API_KEY: FULL.TWILIO_ACCOUNT_SID }, 'TWILIO_API_KEY'],
    ['a number without its country code', { TWILIO_PHONE_NUMBER: '4804708259' }, 'TWILIO_PHONE_NUMBER'],
    ['a public URL that is not https', { PUBLIC_URL: 'http://calls.example.com' }, 'PUBLIC_URL'],
  ])('call %s incomplete, by name', (_, override, name) => {
    expect(readTwilioSettings({ ...FULL, ...override })).toEqual({ status: 'incomplete', missing: [name] });
  });

  it('transcription is optional and apart from the seven: unset, calls work and nothing is recorded', () => {
    const result = readTwilioSettings(FULL);
    expect(result.status === 'on' && result.settings.transcriptionServiceSid).toBeNull();
  });

  it('transcription switches on with a well-formed service id', () => {
    const sid = `GA${hex(32)}`;
    const result = readTwilioSettings({ ...FULL, TWILIO_TRANSCRIPTION_SERVICE_SID: sid });
    expect(result.status === 'on' && result.settings.transcriptionServiceSid).toBe(sid);
  });

  it('a malformed one is named, like any other setting', () => {
    expect(readTwilioSettings({ ...FULL, TWILIO_TRANSCRIPTION_SERVICE_SID: 'IS123' })).toEqual({
      status: 'incomplete',
      missing: ['TWILIO_TRANSCRIPTION_SERVICE_SID'],
    });
  });
});
