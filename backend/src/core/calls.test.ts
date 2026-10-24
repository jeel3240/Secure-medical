import { agentIdFromIdentity, answeredByFor, identityFor, outcomeForStatus, talkSeconds } from './calls';

describe('who a browser is', () => {
  it('round-trips an agent id through the identity Twilio sends back - production, no prefix', () => {
    expect(identityFor(21, '')).toBe('agent-21');
    expect(agentIdFromIdentity('client:agent-21', '')).toBe(21);
    expect(agentIdFromIdentity('agent-21', '')).toBe(21);
  });

  it('puts this server\'s prefix in front, and reads it back', () => {
    expect(identityFor(21, 'dev-')).toBe('dev-agent-21');
    expect(agentIdFromIdentity('client:dev-agent-21', 'dev-')).toBe(21);
    expect(agentIdFromIdentity('dev-agent-21', 'dev-')).toBe(21);
  });

  it('never takes another copy\'s name for one of its own - the clash the prefix exists to stop', () => {
    // Production is not given user 21 by a laptop's browser...
    expect(agentIdFromIdentity('client:dev-agent-21', '')).toBeNull();
    // ...nor a laptop by production's...
    expect(agentIdFromIdentity('client:agent-21', 'dev-')).toBeNull();
    // ...nor by a third copy's.
    expect(agentIdFromIdentity('client:jeel-agent-21', 'dev-')).toBeNull();
  });

  it.each(['client:agent-0', 'client:agent-x', 'client:maya', '+16026203572', '', undefined, 21])(
    'refuses %p',
    (raw) => {
      expect(agentIdFromIdentity(raw, '')).toBeNull();
      expect(agentIdFromIdentity(raw, 'dev-')).toBeNull();
    }
  );
});

describe('how a call ended', () => {
  it.each([
    ['completed', 'answered'],
    ['no-answer', 'no_answer'],
    ['busy', 'busy'],
    ['failed', 'failed'],
    ['canceled', 'canceled'],
  ])('%s is %s', (status, outcome) => {
    expect(outcomeForStatus(status)).toBe(outcome);
  });

  it('Twilio never says missed - that is ours, for an incoming call nobody answered', () => {
    expect(outcomeForStatus('missed')).toBeNull();
    expect(talkSeconds('missed', '12')).toBe(0);
  });

  it('a status on the way is not an ending', () => {
    expect(outcomeForStatus('ringing')).toBeNull();
    expect(outcomeForStatus('in-progress')).toBeNull();
    expect(outcomeForStatus(undefined)).toBeNull();
  });

  it('only an answered call has talk time', () => {
    expect(talkSeconds('answered', '134')).toBe(134);
    expect(talkSeconds('no_answer', '30')).toBe(0);
    expect(talkSeconds('answered', 'abc')).toBe(0);
    expect(talkSeconds('answered', '-4')).toBe(0);
  });
});

describe('who picked up - Twilio\'s answering machine detection', () => {
  it.each([
    ['human', 'human'],
    ['machine_start', 'machine'],
    ['machine_end_beep', 'machine'],
    ['machine_end_silence', 'machine'],
    ['machine_end_other', 'machine'],
    ['fax', 'fax'],
    ['unknown', 'unknown'],
  ])('%s is %s', (raw, verdict) => {
    expect(answeredByFor(raw)).toBe(verdict);
  });

  it('anything else is no verdict at all', () => {
    expect(answeredByFor('robot')).toBeNull();
    expect(answeredByFor('')).toBeNull();
    expect(answeredByFor(undefined)).toBeNull();
  });

  it('Twilio never reports voicemail as an ending - only the verdict makes one', () => {
    expect(outcomeForStatus('voicemail')).toBeNull();
  });
});
