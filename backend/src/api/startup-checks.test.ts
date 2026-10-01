import { startupProblems } from './startup-checks';

const OFF = { status: 'off' } as const;

const STRONG = 'a'.repeat(64);
const TOKEN = 'b'.repeat(48);

describe('what stops the API starting in production', () => {
  it('nothing, with a strong secret and a webhook token', () => {
    expect(startupProblems({ production: true, jwtSecret: STRONG, webhookToken: TOKEN , twilio: OFF})).toEqual([]);
  });

  it('a placeholder or short JWT secret', () => {
    expect(startupProblems({ production: true, jwtSecret: 'change-me', webhookToken: TOKEN , twilio: OFF})).toEqual(['weak_jwt_secret']);
    expect(startupProblems({ production: true, jwtSecret: 'x'.repeat(31), webhookToken: TOKEN , twilio: OFF})).toEqual(['weak_jwt_secret']);
  });

  it('no webhook token, or one short enough to guess', () => {
    expect(startupProblems({ production: true, jwtSecret: STRONG, webhookToken: '' , twilio: OFF})).toEqual(['no_webhook_token']);
    expect(startupProblems({ production: true, jwtSecret: STRONG, webhookToken: 'abc123' , twilio: OFF})).toEqual(['no_webhook_token']);
  });

  it('both at once, so one restart fixes both', () => {
    expect(startupProblems({ production: true, jwtSecret: 'change-me', webhookToken: '' , twilio: OFF})).toEqual([
      'weak_jwt_secret',
      'no_webhook_token',
    ]);
  });

  it('nothing locally, where the plain webhook path is how curl tests it', () => {
    expect(startupProblems({ production: false, jwtSecret: 'change-me', webhookToken: '' , twilio: OFF})).toEqual([]);
  });

  it('refuses Twilio set up only partly in production, but not locally', () => {
    const partial = { status: 'incomplete', missing: ['TWILIO_API_SECRET'] } as const;
    const strong = { jwtSecret: 'a'.repeat(64), webhookToken: 'b'.repeat(48) };
    expect(startupProblems({ production: true, ...strong, twilio: partial })).toEqual(['twilio_incomplete']);
    expect(startupProblems({ production: false, ...strong, twilio: partial })).toEqual([]);
    expect(startupProblems({ production: true, ...strong, twilio: OFF })).toEqual([]);
  });
});
