import { useEffect, useRef } from 'react';
import type { AnswerChip, TimelineEntry } from '../../api/workspace';

/**
 * The workspace centre column: the SMS thread, read as a conversation rather
 * than a log. Redesign of 2026-09-28 - the mockup Jeel supplied.
 *
 * **Messages and system markers only.** Notes, callbacks, dispositions and
 * calls are on the Lead Timeline, which the header links to. An agent mid-call
 * wants to see what the lead actually said, not a merged audit trail; the
 * timeline page still shows everything, and `Timeline.tsx` is unchanged and
 * still used there.
 *
 * **Inbound sits left, ours sits right,** the way every messaging app reads.
 * Automated sends are marked `Auto`, an agent's own send carries their name, so
 * the handoff in STATE-MACHINE.md rule 2b is visible in the thread itself.
 */

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const SHOWN = new Set<TimelineEntry['kind']>(['sms', 'inbound', 'agent_sms', 'system']);

function systemText(detail: Record<string, unknown>): string {
  switch (detail.event) {
    case 'lead_received':
      return `Lead received${detail.source ? ` from ${detail.source}` : ''}`;
    case 'scored':
      return `Scored ${detail.score} · ${detail.tier ?? 'no tier'} · ${detail.status}`;
    case 'agent_took_over':
      return 'Agent took over - automated questions stopped';
    case 'conversation_expired':
      return 'Conversation expired';
    default:
      return String(detail.event ?? 'System event');
  }
}

/**
 * Pairs each inbound reply with the answer it was recorded as, so `3` can be
 * shown as "3 Both".
 *
 * Counting inbound messages and assuming the first is question 1 is wrong the
 * moment a lead sends something unclear, so this matches the digit against the
 * choice actually stored on the conversation and walks the pointer only on a
 * match. Anything it cannot prove - a worded answer like "today please", a
 * reply the flow never accepted - is left as plain text rather than guessed.
 */
export function labelReplies(entries: TimelineEntry[], chips: AnswerChip[]): Map<number, string> {
  const answered = chips.filter((c) => c.choice && c.answer);
  const labels = new Map<number, string>();
  let next = 0;

  entries.forEach((entry, index) => {
    if (entry.kind !== 'inbound' || next >= answered.length) return;
    const body = typeof entry.detail.body === 'string' ? entry.detail.body.trim() : '';
    if (body === answered[next].choice) {
      labels.set(index, answered[next].answer as string);
      next += 1;
    }
  });

  return labels;
}

export function Conversation({
  entries,
  chips,
  leadFirstName,
}: {
  entries: TimelineEntry[];
  chips: AnswerChip[];
  leadFirstName: string;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const shown = entries.filter((e) => SHOWN.has(e.kind));
  const labels = labelReplies(shown, chips);

  // An agent watching for a reply wants the newest in view; the timeline page
  // deliberately does not do this, so a reader is not jumped down the page.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [shown.length]);

  if (shown.length === 0) {
    return <p className="convo__empty">No messages yet.</p>;
  }

  return (
    <div className="convo">
      {shown.map((entry, index) => {
        const at = new Date(entry.at);
        const time = timeFormat.format(at);

        if (entry.kind === 'system') {
          return (
            <p className="convo__system" key={`${entry.at}-${index}`}>
              {systemText(entry.detail)} · {time}
            </p>
          );
        }

        const body = typeof entry.detail.body === 'string' ? entry.detail.body : '';
        const failed = entry.detail.deliveryStatus === 'failed';

        if (entry.kind === 'inbound') {
          const label = labels.get(index);
          return (
            <div className="convo__row convo__row--in" key={`${entry.at}-${index}`}>
              <div className="convo__bubble convo__bubble--in">
                {label ? (
                  <>
                    <span className="convo__choice tabular">{body.trim()}</span>
                    <span className="convo__divider" aria-hidden="true" />
                    <span className="convo__choice-label">{label}</span>
                  </>
                ) : (
                  body
                )}
              </div>
              <p className="convo__meta">
                {leadFirstName} · {time}
              </p>
            </div>
          );
        }

        return (
          <div className="convo__row convo__row--out" key={`${entry.at}-${index}`}>
            <p className="convo__meta">
              {entry.kind === 'agent_sms' ? entry.author ?? 'Agent' : 'Auto'} · {time}
              {failed && <span className="convo__failed"> · delivery failed</span>}
            </p>
            <div
              className={`convo__bubble convo__bubble--out${
                entry.kind === 'agent_sms' ? ' convo__bubble--agent' : ''
              }`}
            >
              {body}
            </div>
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
