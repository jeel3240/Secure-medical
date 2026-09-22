import { queueTag, type QueueFacts } from './queue-tags';

const facts = (over: Partial<QueueFacts> = {}): QueueFacts => ({
  conversationStatus: 'completed',
  answers: ['3', '1', '1'],
  assignedAgentName: null,
  hasUnreadInbound: false,
  callCount: 0,
  nextCallbackAt: null,
  ...over,
});

describe('what an agent sees against a lead', () => {
  it('is New when nothing has happened yet', () => {
    expect(queueTag(facts())).toEqual({ kind: 'new' });
  });

  it('counts call attempts', () => {
    expect(queueTag(facts({ callCount: 2 }))).toEqual({ kind: 'attempted', attempts: 2 });
  });

  it('names the agent holding the lead', () => {
    expect(queueTag(facts({ assignedAgentName: 'Michael' }))).toEqual({
      kind: 'in_progress',
      agentName: 'Michael',
    });
  });

  it('carries the time a callback is due', () => {
    expect(queueTag(facts({ nextCallbackAt: '2026-09-23T15:00:00.000Z' }))).toEqual({
      kind: 'callback',
      callbackAt: '2026-09-23T15:00:00.000Z',
    });
  });

  it('flags an unread reply', () => {
    expect(queueTag(facts({ hasUnreadInbound: true }))).toEqual({ kind: 'inbound_reply' });
  });

  it('flags replies nobody could parse', () => {
    expect(queueTag(facts({ conversationStatus: 'review', answers: [null, null, null] }))).toEqual({
      kind: 'needs_review',
    });
  });

  it.each([
    [['1', null, null] as [string | null, string | null, string | null], 1],
    [['1', '2', null] as [string | null, string | null, string | null], 2],
  ])('says where a partial responder stopped: %j', (answers, step) => {
    expect(queueTag(facts({ conversationStatus: 'open', answers }))).toEqual({ kind: 'stalled', step });
  });

  it('does not call an expired conversation stalled - it is closed, not waiting', () => {
    expect(queueTag(facts({ conversationStatus: 'expired', answers: ['1', null, null] }))).toEqual({
      kind: 'new',
    });
  });

  it('does not call a completed lead stalled', () => {
    expect(queueTag(facts({ conversationStatus: 'completed' }))).toEqual({ kind: 'new' });
  });

  it('does not call a lead with no answers stalled', () => {
    expect(queueTag(facts({ conversationStatus: 'open', answers: [null, null, null] }))).toEqual({
      kind: 'new',
    });
  });
});

describe('when several could apply, the most urgent wins', () => {
  it('a lead someone is working is In progress, whatever else is true', () => {
    expect(
      queueTag(
        facts({
          assignedAgentName: 'Michael',
          nextCallbackAt: '2026-09-23T15:00:00.000Z',
          hasUnreadInbound: true,
          conversationStatus: 'review',
          callCount: 3,
        })
      )
    ).toMatchObject({ kind: 'in_progress' });
  });

  it('a booked callback outranks an unread reply', () => {
    expect(
      queueTag(facts({ nextCallbackAt: '2026-09-23T15:00:00.000Z', hasUnreadInbound: true }))
    ).toMatchObject({ kind: 'callback' });
  });

  it('an unread reply outranks needing review', () => {
    expect(
      queueTag(facts({ hasUnreadInbound: true, conversationStatus: 'review' }))
    ).toMatchObject({ kind: 'inbound_reply' });
  });

  it('needing review outranks being stalled', () => {
    expect(
      queueTag(facts({ conversationStatus: 'review', answers: ['1', null, null] }))
    ).toMatchObject({ kind: 'needs_review' });
  });

  it('being stalled outranks having been called', () => {
    expect(
      queueTag(facts({ conversationStatus: 'open', answers: ['1', null, null], callCount: 1 }))
    ).toMatchObject({ kind: 'stalled' });
  });
});
