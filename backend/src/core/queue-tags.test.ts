import { queueTag, type QueueFacts } from './queue-tags';

const facts = (over: Partial<QueueFacts> = {}): QueueFacts => ({
  conversationStatus: 'completed',
  holder: null,
  hasUnreadInbound: false,
  ...over,
});

describe('what an agent sees against a lead', () => {
  it('flags a call from the lead that nobody answered', () => {
    expect(queueTag(facts({ missedCall: true }))).toEqual({ kind: 'missed_call' });
  });

  it('a missed call outranks an unread text and a callback, but not someone working the lead', () => {
    const nextCallback = { agentId: 21, agentName: 'Maya Chen', at: '2026-09-29T03:13:00.000Z' };
    expect(queueTag(facts({ missedCall: true, hasUnreadInbound: true, nextCallback }))?.kind).toBe('missed_call');
    expect(queueTag(facts({ missedCall: true, holder: { id: 7, name: 'Michael' } }))?.kind).toBe('working');
  });

  it('names whose callback it is, and when', () => {
    const nextCallback = { agentId: 21, agentName: 'Maya Chen', at: '2026-09-29T03:13:00.000Z' };
    expect(queueTag(facts({ nextCallback }))).toEqual({ kind: 'callback', ...nextCallback });
  });

  it('a callback outranks needing review, but not someone working it or an unread reply', () => {
    const nextCallback = { agentId: 21, agentName: 'Maya Chen', at: '2026-09-29T03:13:00.000Z' };
    expect(queueTag(facts({ nextCallback, conversationStatus: 'review' }))?.kind).toBe('callback');
    expect(queueTag(facts({ nextCallback, hasUnreadInbound: true }))?.kind).toBe('inbound_reply');
    expect(queueTag(facts({ nextCallback, holder: { id: 7, name: 'Michael' } }))?.kind).toBe('working');
  });

  it('names the agent holding the lead, with their id to match on', () => {
    expect(queueTag(facts({ holder: { id: 7, name: 'Michael' } }))).toEqual({
      kind: 'working',
      agentId: 7,
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
  it('a lead someone is working says so, whatever else is true', () => {
    expect(
      queueTag(facts({ holder: { id: 7, name: 'Michael' }, hasUnreadInbound: true, conversationStatus: 'review' }))
    ).toMatchObject({ kind: 'working' });
  });

  it('an unread reply outranks needing review', () => {
    expect(queueTag(facts({ hasUnreadInbound: true, conversationStatus: 'review' }))).toMatchObject({
      kind: 'inbound_reply',
    });
  });
});
