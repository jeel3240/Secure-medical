import { useEffect, useRef } from 'react';
import type { TimelineEntry, TimelineKind } from '../api/workspace';
import { DISPOSITION_LABEL, type Disposition } from '../api/workspace';

/**
 * The lead's history: one ordered list built from messages, calls, notes,
 * callbacks, dispositions and the system events the backend derives.
 *
 * Shared by the workspace centre column and the full-width Lead Timeline page,
 * which is why it takes entries rather than fetching: the two screens poll at
 * different times and the page adds a sidebar. Phase 3 task 18.
 *
 * DESIGN-PROMPT.md 3, "Timeline"; AGENT-WORKSPACE.md, "The timeline".
 *
 * **Oldest first, newest at the bottom,** as the brief asks, so the list reads
 * like a conversation. `autoScroll` keeps the newest in view in the workspace,
 * where an agent is watching replies land; the timeline page leaves it off so
 * the page does not jump under someone reading from the top.
 */

const LABEL: Record<TimelineKind, string> = {
  system: 'SYS',
  sms: 'SMS',
  inbound: 'IN',
  agent_sms: 'AGENT',
  call: 'CALL',
  note: 'NOTE',
  callback: 'CB',
  disposition: 'DISP',
};

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** `34s`, `2:14` - how a call length reads in a list. */
function duration(seconds: unknown): string {
  const n = typeof seconds === 'number' ? seconds : 0;
  if (n < 60) return `${n}s`;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** The system events the backend derives, in words. */
function systemText(detail: Record<string, unknown>): string {
  switch (detail.event) {
    case 'lead_received':
      return `Lead received${detail.source ? ` from ${detail.source}` : ''}`;
    case 'scored':
      return `Scored ${detail.score} · ${detail.tier ?? 'no tier'} · ${detail.status}`;
    case 'agent_took_over':
      // Worth spelling out: this is why the automated questions stopped.
      return 'Agent took over - automated questions stopped';
    case 'conversation_expired':
      return 'Conversation expired';
    default:
      return String(detail.event ?? 'System event');
  }
}

function entryText(entry: TimelineEntry): string {
  const d = entry.detail;

  switch (entry.kind) {
    case 'system':
      return systemText(d);
    case 'call': {
      const outcome = typeof d.outcome === 'string' ? d.outcome.replace(/_/g, ' ') : 'call';
      return `Outbound call · ${outcome} · ${duration(d.durationSec)}`;
    }
    case 'callback': {
      const at = typeof d.scheduledAt === 'string' ? new Date(d.scheduledAt) : null;
      const when = at ? `${dayFormat.format(at)} ${timeFormat.format(at)}` : 'unscheduled';
      return d.doneAt ? `Callback completed (was ${when})` : `Callback scheduled for ${when}`;
    }
    case 'disposition': {
      const value = d.value as Disposition;
      return `Disposition: ${DISPOSITION_LABEL[value] ?? value}`;
    }
    default:
      return typeof d.body === 'string' ? d.body : '';
  }
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function Timeline({
  entries,
  autoScroll = false,
  emptyText = 'Nothing has happened on this lead yet.',
}: {
  entries: TimelineEntry[];
  autoScroll?: boolean;
  emptyText?: string;
}) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll) return;
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length, autoScroll]);

  if (entries.length === 0) {
    return <p className="timeline__empty">{emptyText}</p>;
  }

  let lastDay: Date | null = null;

  return (
    <ol className="timeline">
      {entries.map((entry, index) => {
        const at = new Date(entry.at);
        // Day separators, so a lead worked over a week does not read as one
        // long afternoon.
        const newDay = !lastDay || !sameDay(lastDay, at);
        lastDay = at;

        const failed = entry.kind === 'sms' && entry.detail.deliveryStatus === 'failed';

        return (
          <li key={`${entry.kind}-${entry.at}-${index}`}>
            {newDay && <div className="timeline__day">{dayFormat.format(at)}</div>}

            <div className={`timeline__entry timeline__entry--${entry.kind}`}>
              <span className="timeline__kind">{LABEL[entry.kind]}</span>

              <div className="timeline__body">
                <p className="timeline__text">{entryText(entry)}</p>
                <p className="timeline__meta">
                  {entry.author && <span className="timeline__author">{entry.author}</span>}
                  {failed && <span className="timeline__failed">Delivery failed</span>}
                </p>
              </div>

              <time className="timeline__time tabular" dateTime={entry.at}>
                {timeFormat.format(at)}
              </time>
            </div>
          </li>
        );
      })}
      <div ref={bottom} />
    </ol>
  );
}
