/**
 * The structured logger, and the redaction rule it enforces.
 *
 * Redaction is tested hardest because a leak is invisible: the line looks fine
 * in the terminal, and the phone number only turns up months later in whatever
 * collected it. LOGGING.md calls this the one rule that is not a preference.
 */
import { errText, log, redact } from './log';

describe('the line shape', () => {
  let out: jest.SpyInstance;
  let err: jest.SpyInstance;

  beforeEach(() => {
    out = jest.spyOn(console, 'log').mockImplementation(() => {});
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    out.mockRestore();
    err.mockRestore();
  });

  const written = (spy: jest.SpyInstance) => JSON.parse(spy.mock.calls[0][0] as string);

  it('is one JSON object per line', () => {
    log.info('poll.tick', { fetched: 2, inserted: 1, ms: 336 });

    expect(out).toHaveBeenCalledTimes(1);
    expect(written(out)).toMatchObject({
      level: 'info',
      event: 'poll.tick',
      fetched: 2,
      inserted: 1,
      ms: 336,
    });
  });

  it('carries a timestamp and the service that wrote it', () => {
    log.info('worker.started');
    const line = written(out);

    expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // So api and worker can be told apart in one stream.
    expect(line.svc).toEqual(expect.any(String));
  });

  it('sends warn and error to stderr', () => {
    // level=error is meant to be the cheapest useful alarm, and most collectors
    // alert on a container's stderr.
    log.warn('webhook.ignored');
    log.error('sms.failed');

    expect(err).toHaveBeenCalledTimes(2);
    expect(out).not.toHaveBeenCalled();
  });

  it('drops undefined fields rather than logging nulls', () => {
    log.info('sms.sent', { leadId: 42, eztMessageId: undefined });
    const line = written(out);

    expect(line.leadId).toBe(42);
    expect('eztMessageId' in line).toBe(false);
  });

  it('keeps a field that is deliberately null', () => {
    log.info('conversation.advanced', { leadId: 42, tier: null });
    expect(written(out).tier).toBeNull();
  });
});

describe('redaction', () => {
  it.each([
    'phone',
    'fromNumber',
    'toNumber',
    'body',
    'message',
    'firstName',
    'lastName',
    'email',
    'password',
    'token',
  ])('hides %s', (field) => {
    expect(redact({ [field]: 'sensitive' })[field]).toBe('[redacted]');
  });

  it('ignores case', () => {
    expect(redact({ PHONE: '+15551234567' }).PHONE).toBe('[redacted]');
    expect(redact({ FromNumber: '+15551234567' }).FromNumber).toBe('[redacted]');
  });

  it('catches suffixes it was never told about', () => {
    // apiKey, accessToken, jwtSecret - so a new field name is safe by default.
    const out = redact({ apiKey: 'k', accessToken: 't', jwtSecret: 's', leadPhone: 'p' });

    expect(out).toEqual({
      apiKey: '[redacted]',
      accessToken: '[redacted]',
      jwtSecret: '[redacted]',
      leadPhone: '[redacted]',
    });
  });

  it('marks the field rather than dropping it', () => {
    // A vanished field is harder to debug than an obviously hidden one.
    expect('phone' in redact({ phone: '+15551234567' })).toBe(true);
  });

  it('reaches one level into an object', () => {
    const out = redact({ lead: { id: 42, phone: '+15551234567' } }) as {
      lead: Record<string, unknown>;
    };

    expect(out.lead.id).toBe(42);
    expect(out.lead.phone).toBe('[redacted]');
  });

  it('keeps the identifiers a line is useful for', () => {
    // A leadId is enough to find the row, and the row has the rest.
    const out = redact({ leadId: 42, conversationId: 7, score: 100, tier: 'HOT' });

    expect(out).toEqual({ leadId: 42, conversationId: 7, score: 100, tier: 'HOT' });
  });

  it('reduces an Error to its message', () => {
    // A stack can hold a message body in an interpolated string.
    const out = redact({ err: new Error('upstream 500') });
    expect(out.err).toBe('upstream 500');
  });
});

describe('errText', () => {
  it('prefers the response body, which is where EZ Texting puts the reason', () => {
    expect(errText({ response: { data: { error: 'rate limited' } } })).toBe(
      '{"error":"rate limited"}'
    );
  });

  it('passes a string body through', () => {
    expect(errText({ response: { data: 'Bad Gateway' } })).toBe('Bad Gateway');
  });

  it('falls back to the message', () => {
    expect(errText(new Error('socket hang up'))).toBe('socket hang up');
  });

  it('copes with something that is not an Error at all', () => {
    expect(errText('plain string')).toBe('plain string');
  });

  it('never returns a stack', () => {
    const err = new Error('boom');
    expect(errText(err)).not.toContain('at ');
  });
});
