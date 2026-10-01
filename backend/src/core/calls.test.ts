import { agentIdFromIdentity, identityFor, outcomeForStatus, talkSeconds } from './calls';

describe('who a browser is', () => {
  it('round-trips an agent id through the identity Twilio sends back', () => {
    expect(identityFor(21)).toBe('agent-21');
    expect(agentIdFromIdentity('client:agent-21')).toBe(21);
    expect(agentIdFromIdentity('agent-21')).toBe(21);
  });

  it.each(['client:agent-0', 'client:agent-x', 'client:maya', '+16026203572', '', undefined, 21])(
    'refuses %p',
    (raw) => {
      expect(agentIdFromIdentity(raw)).toBeNull();
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
