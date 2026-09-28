import { queueTag, type QueueFacts } from './queue-tags';

const facts = (over: Partial<QueueFacts> = {}): QueueFacts => ({
  conversationStatus: 'completed',
  assignedAgentName: null,
  hasUnreadInbound: false,
  ...over,
});

describe('what an agent sees against a lead', () => {
  it('names the agent holding the lead', () => {
    expect(queueTag(facts({ assignedAgentName: 'Michael' }))).toEqual({
      kind: 'in_progress',
      agentName: 'Michael',
    });
  });

  it('flags an unread reply', () => {
    expect(queueTag(facts({ hasUnreadInbound: true }))).toEqual({ kind: 'inbound_reply' });
  });

  it('flags replies nobody could parse', () => {
    expect(queueTag(facts({ conversationStatus: 'review' }))).toEqual({ kind: 'needs_review' });
  });

  it('says nothing about a lead that is simply waiting to be picked up', () => {
    // No New, Attempted or Callback: that history is the working agent's to
    // remember, not the home page's to repeat - Jeel, 2026-09-28.
    expect(queueTag(facts())).toBeNull();
  });

  it('says nothing about an open conversation - partway leads are not in the queue at all', () => {
    expect(queueTag(facts({ conversationStatus: 'open' }))).toBeNull();
  });
});

describe('when several could apply, the most urgent wins', () => {
  it('a lead someone is working is In progress, whatever else is true', () => {
    expect(
      queueTag(facts({ assignedAgentName: 'Michael', hasUnreadInbound: true, conversationStatus: 'review' }))
    ).toMatchObject({ kind: 'in_progress' });
  });

  it('an unread reply outranks needing review', () => {
    expect(queueTag(facts({ hasUnreadInbound: true, conversationStatus: 'review' }))).toMatchObject({
      kind: 'inbound_reply',
    });
  });
});
