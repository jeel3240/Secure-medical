/**
 * The timeline page's summary sidebar.
 *
 * Tested because every figure in the sidebar comes out of this one function,
 * and a miscount renders as a plausible wrong number rather than an error -
 * "2 calls" when there was one is not something a glance catches.
 */
import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '../api/workspace';
import { summarise } from './LeadTimelinePage';

const at = (hhmm: string) => `2026-09-26T${hhmm}:00.000Z`;

const entry = (
  kind: TimelineEntry['kind'],
  time: string,
  detail: Record<string, unknown> = {},
  author: string | null = null
): TimelineEntry => ({ kind, at: at(time), author, detail });

describe('attempts', () => {
  it('counts calls, outbound SMS and inbound replies apart', () => {
    const summary = summarise([
      entry('sms', '09:00', { body: 'opener' }),
      entry('inbound', '09:01', { body: '3' }),
      entry('sms', '09:02', { body: 'question 2' }),
      entry('agent_sms', '09:10', { body: 'hi' }, 'Rae'),
      entry('call', '09:20', { outcome: 'no_answer', durationSec: 12 }, 'Rae'),
    ]);

    // An agent's manual message is still an outbound attempt.
    expect(summary.smsOut).toBe(3);
    expect(summary.smsIn).toBe(1);
    expect(summary.calls).toBe(1);
  });

  it('is all zeros for a lead nothing has happened to', () => {
    const summary = summarise([entry('system', '09:00', { event: 'lead_received' })]);
    expect(summary).toMatchObject({ calls: 0, smsOut: 0, smsIn: 0, lastContact: null });
  });
});

describe('last contact', () => {
  it('is the most recent message or call', () => {
    const summary = summarise([
      entry('sms', '09:00', { body: 'opener' }),
      entry('inbound', '09:05', { body: 'today' }),
    ]);

    expect(summary.lastContact).toEqual({ at: at('09:05'), inbound: true });
  });

  it('does not count a note or a disposition as contact', () => {
    const summary = summarise([
      entry('inbound', '09:05', { body: 'today' }),
      entry('note', '09:30', { body: 'spoke to them' }, 'Rae'),
      entry('disposition', '09:31', { value: 'interested' }, 'Rae'),
    ]);

    // Our own record of a lead is not contact with them.
    expect(summary.lastContact).toEqual({ at: at('09:05'), inbound: true });
  });

  it('marks an outbound one as not inbound', () => {
    const summary = summarise([entry('agent_sms', '09:10', { body: 'hi' }, 'Rae')]);
    expect(summary.lastContact?.inbound).toBe(false);
  });
});

describe('next action', () => {
  it('is the soonest callback still to be done', () => {
    const summary = summarise([
      entry('callback', '09:00', { scheduledAt: at('16:00'), doneAt: null }, 'Rae'),
      entry('callback', '09:01', { scheduledAt: at('14:00'), doneAt: null }, 'Maya'),
    ]);

    expect(summary.nextCallback).toEqual({ at: at('14:00'), agent: 'Maya' });
  });

  it('ignores one already done', () => {
    const summary = summarise([
      entry('callback', '09:00', { scheduledAt: at('10:00'), doneAt: at('10:05') }, 'Rae'),
    ]);

    expect(summary.nextCallback).toBeNull();
  });

  it('is null when none is scheduled', () => {
    expect(summarise([entry('note', '09:00', { body: 'x' }, 'Rae')]).nextCallback).toBeNull();
  });
});

describe('dispositions', () => {
  it('keeps every one, in the order they happened', () => {
    const summary = summarise([
      entry('disposition', '09:00', { value: 'no_answer' }, 'Rae'),
      entry('disposition', '10:00', { value: 'interested' }, 'Maya'),
    ]);

    // Append-only: three no_answers then interested is a different story from
    // one interested, and the sidebar shows the sequence.
    expect(summary.dispositions).toEqual([
      { at: at('09:00'), value: 'no_answer', agent: 'Rae' },
      { at: at('10:00'), value: 'interested', agent: 'Maya' },
    ]);
  });
});
