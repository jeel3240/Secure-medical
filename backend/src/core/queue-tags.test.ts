import { queueTag, type QueueFacts } from './queue-tags';

const facts = (over: Partial<QueueFacts> = {}): QueueFacts => ({
  conversationStatus: 'completed',
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
    expect(queueTag(facts({ conversationStatus: 'review' }))).toEqual({ kind: 'needs_review' });
  });

  it('has no stalled tag - a lead partway through is not in the queue at all', () => {
    // db/queue.ts keeps an open conversation out unless someone is working it,
    // so whatever brought it in outranks being partway: Jeel, 2026-09-28.
    expect(queueTag(facts({ conversationStatus: 'open' }))).toEqual({ kind: 'new' });
  });

  it('calls a completed lead New when nothing has happened', () => {
    expect(queueTag(facts({ conversationStatus: 'completed' }))).toEqual({ kind: 'new' });
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

  it('needing review outranks having been called', () => {
    expect(queueTag(facts({ conversationStatus: 'review', callCount: 2 }))).toMatchObject({
      kind: 'needs_review',
    });
  });
});
