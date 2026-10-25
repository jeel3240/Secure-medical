import { useEffect, useRef } from 'react';
import type { TimelineEntry, TimelineKind } from '../api/workspace';
import { DISPOSITION_LABEL, type Disposition } from '../api/workspace';
import { CALL_RESULT_WORDS } from '../lib/call-results';
import { dayLabel, formatDay, formatTime, isSameDay } from '../lib/format';
import { CallAnswers } from './CallAnswers';
import { CallTranscript } from './CallTranscript';

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


/**
 * The robot's call by how its script ended (`lib/call-results.ts`, shared with
 * Admin > Leads), or null while it has no result - then it reads as T5 had it.
 */
function robotCallText(detail: Record<string, unknown>, author: string | null): string | null {
  const result = detail.scriptResult;
  if (typeof result !== 'string') return null;
  if (result === 'transferred') return `Automated call · said yes · ${author ?? 'an agent'} took it · ${duration(detail.durationSec)}`;
  // Never picked up: Twilio's words for why, as for any call we place.
  if (result === 'unanswered') {
    const why = typeof detail.outcome === 'string' && detail.outcome !== 'voicemail' ? CALL_OUTCOME[detail.outcome] : null;
    return `Automated call · ${why ?? 'no answer'}`;
  }
  return `Automated call · ${CALL_RESULT_WORDS[result] ?? result.replace(/_/g, ' ')}`;
}

/**
 * `author` is the agent on the call: theirs, the one it rang, or - on the
 * robot's call - who took its transfer, named in the line itself.
 */
export function callText(detail: Record<string, unknown>, author: string | null = null): string {
  const { outcome } = detail;
  // A lead calling us. Missed says it all; an answered one has a length.
  if (detail.direction === 'inbound') {
    if (typeof outcome !== 'string') return 'Incoming call · ringing';
    if (outcome === 'missed') return 'Missed call · told we will call back';
    if (outcome === 'answered') return `Incoming call · answered · ${duration(detail.durationSec)}`;
    return `Incoming call · ${CALL_OUTCOME[outcome] ?? outcome.replace(/_/g, ' ')}`;
  }
  // The robot's call says how its script ended (T21); until it has, and for an
  // agent's call, the call itself in words (T5).
  if (detail.direction === 'automated') {
    const robot = robotCallText(detail, author);
    if (robot) return robot;
  }
  const what = detail.direction === 'automated' ? 'Automated call' : 'Outbound call';
  if (typeof outcome !== 'string') return `${what} · in progress`;
  if (outcome === 'answered') return `${what} · answered · ${duration(detail.durationSec)}`;
  return `${what} · ${CALL_OUTCOME[outcome] ?? outcome.replace(/_/g, ' ')}`;
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
    return date ? `${formatDay(date)} ${formatTime(date)}` : 'an unknown time';
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

/**
 * How the questions stood when the score was earned. A lead who asked only for
 * offers, or to hear from a rep, has a `completed` conversation too - and
 * "completed" alone would read as the questions answered.
 */
function scoredAs(detail: Record<string, unknown>): string {
  if (detail.endOutcome === 'offers') return 'offers only';
  if (detail.endOutcome === 'wants_contact') return 'wants a call';
  if (detail.endOutcome === 'declined') return 'not interested';
  return String(detail.status);
}

/** The words for a system event - shared with the workspace conversation. */
export function systemText(detail: Record<string, unknown>): string {
  switch (detail.event) {
    case 'lead_received':
      return `Lead received${detail.source ? ` from ${detail.source}` : ''}`;
    case 'scored':
      return `Scored ${detail.score} · ${detail.tier ?? 'no tier'} · ${scoredAs(detail)}`;
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
      return callText(d, entry.author);
    case 'callback': {
      const at = typeof d.scheduledAt === 'string' ? new Date(d.scheduledAt) : null;
      const when = at ? `${formatDay(at)} ${formatTime(at)}` : 'unscheduled';
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
  const now = new Date();

  return (
    <ol className="timeline">
      {entries.map((entry, index) => {
        const at = new Date(entry.at);
        // Day separators, so a lead worked over a week does not read as one
        // long afternoon - named as the conversation names them (W1).
        const newDay = !lastDay || !isSameDay(lastDay, at);
        lastDay = at;

        const failed = entry.kind === 'sms' && entry.detail.deliveryStatus === 'failed';
        // The robot's call names who took it in its own line (T21).
        const robotCall = entry.kind === 'call' && entry.detail.direction === 'automated';
        const byline = robotCall ? null : entry.author;

        return (
          <li key={`${entry.kind}-${entry.at}-${index}`}>
            {newDay && <div className="timeline__day">{dayLabel(at, now)}</div>}

            <div className={`timeline__entry timeline__entry--${entry.kind}`}>
              <span className="timeline__kind">{LABEL[entry.kind]}</span>

              <div className="timeline__body">
                <p className="timeline__text">{entryText(entry)}</p>
                <p className="timeline__meta">
                  {byline && <span className="timeline__author">{byline}</span>}
                  {failed && <span className="timeline__failed">Delivery failed</span>}
                </p>
                {entry.kind === 'call' && <CallAnswers detail={entry.detail} />}
                {entry.kind === 'call' && <CallTranscript detail={entry.detail} agentName={entry.author} />}
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
