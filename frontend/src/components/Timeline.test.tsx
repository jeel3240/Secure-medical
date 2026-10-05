/**
 * The timeline's wording and ordering.
 *
 * Tested because each entry kind reads from a different `detail` shape, and a
 * wrong field renders as a blank line rather than an error - the kind of bug
 * that survives a glance at the screen.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '../api/workspace';
import { activityText, Timeline } from './Timeline';

const at = (iso: string) => `2026-09-26T${iso}.000Z`;

const entry = (e: Partial<TimelineEntry> & Pick<TimelineEntry, 'kind'>): TimelineEntry => ({
  at: at('12:00:00'),
  author: null,
  detail: {},
  ...e,
});

describe('system events', () => {
  it('names where the lead came from', () => {
    render(
      <Timeline
        entries={[entry({ kind: 'system', detail: { event: 'lead_received', source: 'CORE-G-27' } })]}
      />
    );
    expect(screen.getByText('Lead received from CORE-G-27')).toBeDefined();
  });

  it('copes with no source', () => {
    render(<Timeline entries={[entry({ kind: 'system', detail: { event: 'lead_received' } })]} />);
    expect(screen.getByText('Lead received')).toBeDefined();
  });

  it('shows the score, tier and status together', () => {
    render(
      <Timeline
        entries={[
          entry({ kind: 'system', detail: { event: 'scored', score: 100, tier: 'HOT', status: 'completed' } }),
        ]}
      />
    );
    expect(screen.getByText('Scored 100 · HOT · completed')).toBeDefined();
  });

  it('spells out why the questions stopped', () => {
    render(<Timeline entries={[entry({ kind: 'system', detail: { event: 'agent_took_over' } })]} />);
    // An agent seeing "took over" alone would not know the flow had stopped.
    expect(screen.getByText(/automated questions stopped/i)).toBeDefined();
  });

  it('does not blank out on an event it has never seen', () => {
    render(<Timeline entries={[entry({ kind: 'system', detail: { event: 'something_new' } })]} />);
    expect(screen.getByText('something_new')).toBeDefined();
  });
});

describe('messages', () => {
  it('shows an inbound reply as the lead typed it', () => {
    render(<Timeline entries={[entry({ kind: 'inbound', detail: { body: 'today please' } })]} />);
    expect(screen.getByText('today please')).toBeDefined();
  });

  it('names the agent on a manual message', () => {
    render(
      <Timeline
        entries={[entry({ kind: 'agent_sms', author: 'Rae Whitfield', detail: { body: 'Is now a good time?' } })]}
      />
    );
    expect(screen.getByText('Is now a good time?')).toBeDefined();
    expect(screen.getByText('Rae Whitfield')).toBeDefined();
  });

  it('flags a failed delivery', () => {
    render(
      <Timeline
        entries={[entry({ kind: 'sms', detail: { body: 'Question 2 of 3', deliveryStatus: 'failed' } })]}
      />
    );
    // A message that never arrived explains a silence that otherwise looks
    // like the lead ignoring us.
    expect(screen.getByText('Delivery failed')).toBeDefined();
  });

  it('says nothing about delivery when it went out fine', () => {
    render(
      <Timeline
        entries={[entry({ kind: 'sms', detail: { body: 'Question 2 of 3', deliveryStatus: 'sent' } })]}
      />
    );
    expect(screen.queryByText('Delivery failed')).toBeNull();
  });
});

describe('calls', () => {
  // The outcomes are the ones the server records from Twilio - core/calls.ts.
  it.each([
    ['answered', 134, 'Outbound call · answered · 2:14'],
    ['answered', 34, 'Outbound call · answered · 34s'],
    ['no_answer', 0, 'Outbound call · no answer'],
    ['voicemail', 22, 'Outbound call · voicemail'],
    ['busy', 0, 'Outbound call · busy'],
    ['failed', 0, 'Outbound call · failed'],
    ['canceled', 0, 'Outbound call · cancelled'],
  ])('%s reads as it went, with a length only when answered', (outcome, durationSec, text) => {
    render(<Timeline entries={[entry({ kind: 'call', author: 'Rae', detail: { outcome, durationSec } })]} />);
    expect(screen.getByText(text)).toBeDefined();
  });

  it.each([
    ['missed', 0, 'Missed call · told we will call back'],
    ['answered', 75, 'Incoming call · answered · 1:15'],
    [null, null, 'Incoming call · ringing'],
  ])('a lead calling us, %s: says so', (outcome, durationSec, text) => {
    render(<Timeline entries={[entry({ kind: 'call', detail: { outcome, durationSec, direction: 'inbound' } })]} />);
    expect(screen.getByText(text)).toBeDefined();
  });

  it('a call with no outcome yet is in progress', () => {
    render(<Timeline entries={[entry({ kind: 'call', detail: { outcome: null, durationSec: null } })]} />);
    expect(screen.getByText('Outbound call · in progress')).toBeDefined();
  });
});

describe('callbacks and dispositions', () => {
  it.each([
    [null, 'Callback added · missed call'],
    ['done', 'Missed call returned'],
  ])('a callback the system booked for a missed call (%s) says so, not a time', (done, text) => {
    const detail = { scheduledAt: at('15:30:00'), doneAt: done ? at('15:40:00') : null, reason: 'missed_call' };
    render(<Timeline entries={[entry({ kind: 'callback', detail })]} />);
    expect(screen.getByText(text)).toBeDefined();
  });

  it('says when a callback is due', () => {
    render(
      <Timeline
        entries={[entry({ kind: 'callback', detail: { scheduledAt: at('15:30:00'), doneAt: null } })]}
      />
    );
    expect(screen.getByText(/Callback scheduled for/)).toBeDefined();
  });

  it('reads differently once it is done', () => {
    render(
      <Timeline
        entries={[entry({ kind: 'callback', detail: { scheduledAt: at('15:30:00'), doneAt: at('15:34:00') } })]}
      />
    );
    expect(screen.getByText(/Callback completed/)).toBeDefined();
  });

  it('shows a disposition in the words the agent chose', () => {
    render(<Timeline entries={[entry({ kind: 'disposition', detail: { value: 'callback_set' } })]} />);
    // Not "callback_set".
    expect(screen.getByText('Disposition: Callback set')).toBeDefined();
  });
});

describe('the list', () => {
  it('says so when there is nothing yet', () => {
    render(<Timeline entries={[]} />);
    expect(screen.getByText(/Nothing has happened/)).toBeDefined();
  });

  it('keeps the order it is given', () => {
    render(
      <Timeline
        entries={[
          entry({ kind: 'system', at: at('09:00:00'), detail: { event: 'lead_received' } }),
          entry({ kind: 'inbound', at: at('09:05:00'), detail: { body: 'first reply' } }),
          entry({ kind: 'note', at: at('09:10:00'), author: 'Rae', detail: { body: 'called back' } }),
        ]}
      />
    );

    const items = screen.getAllByRole('listitem');
    // Oldest first, newest at the bottom - the brief's reading order.
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Lead received');
    expect(items[2].textContent).toContain('called back');
  });

  it('separates days', () => {
    const { container } = render(
      <Timeline
        entries={[
          entry({ kind: 'inbound', at: '2026-09-25T09:00:00.000Z', detail: { body: 'day one' } }),
          entry({ kind: 'inbound', at: '2026-09-26T09:00:00.000Z', detail: { body: 'day two' } }),
        ]}
      />
    );
    // A lead worked over a week should not read as one long afternoon.
    expect(container.querySelectorAll('.timeline__day')).toHaveLength(2);
  });

  it('does not separate entries from the same day', () => {
    const { container } = render(
      <Timeline
        entries={[
          entry({ kind: 'inbound', at: at('09:00:00'), detail: { body: 'one' } }),
          entry({ kind: 'inbound', at: at('09:05:00'), detail: { body: 'two' } }),
        ]}
      />
    );
    expect(container.querySelectorAll('.timeline__day')).toHaveLength(1);
  });
});

describe('what the activity log adds - AUDIT.md', () => {
  const at = '2026-10-01T15:40:00Z';

  it.each([
    [{ action: 'lead.picked_up' }, 'Picked up the lead'],
    [{ action: 'lead.released', heldSince: '2026-10-01T15:00:00Z', forced: false }, 'Put the lead back in the queue · held 40 min'],
    [{ action: 'lead.released', heldSince: '2026-10-01T13:35:00Z', forced: false, because: 'outcome' }, 'Lead released - outcome saved · held 2 h 5 min'],
    [{ action: 'lead.released', heldSince: '2026-10-01T15:39:50Z', forced: true, subject: 'Maya Chen' }, 'Released the lead from Maya Chen · held under a minute'],
    [{ action: 'callback.reopened' }, 'Callback reopened - it had been marked done'],
    [{ action: 'sms.blocked' }, 'Text not sent - the number is on the do-not-call list'],
    [{ action: 'call.refused', reason: 'not_holder' }, 'Call not placed - the lead was not picked up'],
  ])('%j', (detail, text) => {
    expect(activityText(detail, at)).toBe(text);
  });

  it('a moved callback says where from and where to', () => {
    const text = activityText({ action: 'callback.rescheduled', from: '2026-10-01T17:00:00Z', to: '2026-10-03T17:00:00Z' }, at);
    expect(text).toMatch(/^Callback moved from .+ to .+$/);
    expect(text.split(' to ')[0]).not.toBe(text.split(' to ')[1]);
  });

  it('shows on the timeline under LOG, with who did it', () => {
    render(<Timeline entries={[entry({ kind: 'activity', author: 'Maya Chen', detail: { action: 'lead.picked_up' } })]} />);
    expect(screen.getByText('Picked up the lead')).toBeDefined();
    expect(screen.getByText('LOG')).toBeDefined();
  });
});

