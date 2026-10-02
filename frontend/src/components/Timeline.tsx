import { useEffect, useRef } from 'react';
import type { TimelineEntry, TimelineKind } from '../api/workspace';
import { DISPOSITION_LABEL, type Disposition } from '../api/workspace';
import { formatTime } from '../lib/format';

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
  activity: 'LOG',
};

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
/**
 * A call in words - shared with the workspace conversation. Only an answered
 * call has a length worth showing; "no answer · 0s" said nothing. A call with
 * no outcome yet is still going, or Twilio has not reported back.
 */
const CALL_OUTCOME: Record<string, string> = {
  // A machine picked up, not the lead - Twilio's detection, TWILIO.md "Voicemail".
  voicemail: 'voicemail',
  no_answer: 'no answer',
  busy: 'busy',
  failed: 'failed',
  canceled: 'cancelled',
};

export function callText(detail: Record<string, unknown>): string {
  const { outcome } = detail;
  // A lead calling us. Missed says it all; an answered one has a length.
  if (detail.direction === 'inbound') {
    if (typeof outcome !== 'string') return 'Incoming call · ringing';
    if (outcome === 'missed') return 'Missed call · told we will call back';
    if (outcome === 'answered') return `Incoming call · answered · ${duration(detail.durationSec)}`;
    return `Incoming call · ${CALL_OUTCOME[outcome] ?? outcome.replace(/_/g, ' ')}`;
  }
  if (typeof outcome !== 'string') return 'Outbound call · in progress';
  if (outcome === 'answered') return `Outbound call · answered · ${duration(detail.durationSec)}`;
  return `Outbound call · ${CALL_OUTCOME[outcome] ?? outcome.replace(/_/g, ' ')}`;
}

const CALL_REFUSAL: Record<string, string> = {
  not_holder: 'the lead was not picked up',
  blocked: 'the number is on the do-not-call list',
  not_found: 'the lead could not be found',
};

/** `40 min`, `2 h 5 min` - how long a lead was held. */
function heldFor(sinceIso: unknown, untilIso: string): string | null {
  if (typeof sinceIso !== 'string') return null;
  const minutes = Math.round((Date.parse(untilIso) - Date.parse(sinceIso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 1) return 'under a minute';
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * An activity-log entry in words - AUDIT.md. These are the actions that leave
 * no row of their own: who held the lead and for how long, a callback that was
 * moved, a text or a call that was refused. `at` is when it happened, which a
 * release needs to say how long the lead had been held.
 */
export function activityText(detail: Record<string, unknown>, at: string): string {
  const subject = typeof detail.subject === 'string' ? detail.subject : null;
  const when = (iso: unknown) => {
    const date = typeof iso === 'string' ? new Date(iso) : null;
    return date ? `${dayFormat.format(date)} ${formatTime(date)}` : 'an unknown time';
  };

  switch (detail.action) {
    case 'lead.picked_up':
      return 'Picked up the lead';
    case 'lead.released': {
      const held = heldFor(detail.heldSince, at);
      const how = detail.forced
        ? `Released the lead from ${subject ?? 'another agent'}`
        : detail.because === 'outcome'
          ? 'Lead released - outcome saved'
          : 'Put the lead back in the queue';
      return held ? `${how} · held ${held}` : how;
    }
    case 'callback.rescheduled':
      return `Callback moved from ${when(detail.from)} to ${when(detail.to)}`;
    case 'callback.reopened':
      return 'Callback reopened - it had been marked done';
    case 'sms.blocked':
      return 'Text not sent - the number is on the do-not-call list';
    case 'call.refused':
      return `Call not placed - ${CALL_REFUSAL[String(detail.reason)] ?? 'it was refused'}`;
    default:
      return String(detail.action ?? 'Activity');
  }
}

/** The words for a system event - shared with the workspace conversation. */
export function systemText(detail: Record<string, unknown>): string {
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
    case 'call':
      return callText(d);
    case 'callback': {
      const at = typeof d.scheduledAt === 'string' ? new Date(d.scheduledAt) : null;
      const when = at ? `${dayFormat.format(at)} ${formatTime(at)}` : 'unscheduled';
      // One the system booked because their call was missed has no chosen time.
      if (d.reason === 'missed_call') return d.doneAt ? 'Missed call returned' : 'Callback added · missed call';
      return d.doneAt ? `Callback completed (was ${when})` : `Callback scheduled for ${when}`;
    }
    case 'disposition': {
      const value = d.value as Disposition;
      return `Disposition: ${DISPOSITION_LABEL[value] ?? value}`;
    }
    case 'activity':
      return activityText(d, entry.at);
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
                {formatTime(at)}
              </time>
            </div>
          </li>
        );
      })}
      <div ref={bottom} />
    </ol>
  );
}
