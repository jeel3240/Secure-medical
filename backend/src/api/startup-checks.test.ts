import { startupProblems } from './startup-checks';

const STRONG = 'a'.repeat(64);
const TOKEN = 'b'.repeat(48);

describe('what stops the API starting in production', () => {
  it('nothing, with a strong secret and a webhook token', () => {
    expect(startupProblems({ production: true, jwtSecret: STRONG, webhookToken: TOKEN })).toEqual([]);
  });

  it('a placeholder or short JWT secret', () => {
    expect(startupProblems({ production: true, jwtSecret: 'change-me', webhookToken: TOKEN })).toEqual(['weak_jwt_secret']);
    expect(startupProblems({ production: true, jwtSecret: 'x'.repeat(31), webhookToken: TOKEN })).toEqual(['weak_jwt_secret']);
  });

  it('no webhook token, or one short enough to guess', () => {
    expect(startupProblems({ production: true, jwtSecret: STRONG, webhookToken: '' })).toEqual(['no_webhook_token']);
    expect(startupProblems({ production: true, jwtSecret: STRONG, webhookToken: 'abc123' })).toEqual(['no_webhook_token']);
  });

  it('both at once, so one restart fixes both', () => {
    expect(startupProblems({ production: true, jwtSecret: 'change-me', webhookToken: '' })).toEqual([
      'weak_jwt_secret',
      'no_webhook_token',
    ]);
  });

  it('nothing locally, where the plain webhook path is how curl tests it', () => {
    expect(startupProblems({ production: false, jwtSecret: 'change-me', webhookToken: '' })).toEqual([]);
  });
});
