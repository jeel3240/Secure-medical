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
import { Timeline } from './Timeline';

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
  it('reads outcome and length', () => {
    render(
      <Timeline
        entries={[entry({ kind: 'call', author: 'Rae', detail: { outcome: 'no_answer', durationSec: 34 } })]}
      />
    );
    expect(screen.getByText('Outbound call · no answer · 34s')).toBeDefined();
  });

  it('shows a long call as m:ss', () => {
    render(<Timeline entries={[entry({ kind: 'call', detail: { outcome: 'completed', durationSec: 134 } })]} />);
    expect(screen.getByText('Outbound call · completed · 2:14')).toBeDefined();
  });
});

describe('callbacks and dispositions', () => {
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
