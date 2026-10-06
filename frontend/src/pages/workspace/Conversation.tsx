import { useEffect, useRef } from 'react';
import type { TimelineEntry } from '../../api/workspace';
import { CallTranscript } from '../../components/CallTranscript';
import { callText, systemText } from '../../components/Timeline';
import { formatTime } from '../../lib/format';

/**
 * The workspace centre column: the SMS thread, read as a conversation rather
 * than a log. Redesign of 2026-09-28 - the mockup Jeel supplied.
 *
 * **Messages, calls and system markers.** Notes, callbacks and dispositions are
 * on the Lead Timeline, which the header links to. Calls joined the thread in
 * Phase 4, as a quiet line: an agent who has just called wants to see that it
 * was recorded, and the next one that it happened. An agent mid-call
 * wants to see what the lead actually said, not a merged audit trail; the
 * timeline page still shows everything, and `Timeline.tsx` is unchanged and
 * still used there.
 *
 * **Inbound sits left, ours sits right,** the way every messaging app reads.
 * Automated sends are marked `Auto`, an agent's own send carries their name, so
 * the handoff in STATE-MACHINE.md rule 2b is visible in the thread itself.
 */


const SHOWN = new Set<TimelineEntry['kind']>(['sms', 'inbound', 'agent_sms', 'call', 'system']);

/**
 * The answer an inbound reply was recorded as, when it is worth showing beside
 * what the lead typed: `1` reads "1 | Yes".
 *
 * It comes from the server with the message - the answer row names the text it
 * was read from (migration 012). Until 2026-10-06 this screen worked it out,
 * walking the lead's answers in order and matching digits; a worded answer
 * ("yes") was skipped, and the next digit then took its label - "1 | Yes" on a
 * reply that meant "I know which antibiotic".
 *
 * Nothing is added when the lead typed the answer's own words: "Yes | Yes"
 * says it twice.
 */
export function replyLabel(entry: TimelineEntry): string | null {
  const answer = entry.detail.answer;
  if (entry.kind !== 'inbound' || typeof answer !== 'string' || !answer) return null;
  const body = typeof entry.detail.body === 'string' ? entry.detail.body : '';
  const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return plain(body) === plain(answer) ? null : answer;
}

/**
 * Two ticks on a message we sent - Jeel, 2026-09-28, in place of a "Sent."
 * banner under the composer. Pinned to the bubble's bottom-right corner, as in
 * WhatsApp, so they sit in the same place however the text wraps.
 *
 * **They mean EZ Texting accepted the message**, not that it reached the
 * phone. That is Jeel's decision: acceptance is what the send call tells us,
 * and a message is in the thread as sent only once it has happened. Nothing
 * tells us about the phone - EZ Texting sends no delivery reports we read.
 */
function SentTicks() {
  return (
    <svg
      className="convo__tick"
      width="18"
      height="12"
      viewBox="0 0 27 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Sent"
    >
      <title>Sent - EZ Texting accepted it</title>
      {/* The second tick sits 7 units right of the first; its short stroke is
          left out, so it reads as a pair, as on a phone. */}
      <path d="M2 9.5l4.5 4.5L16 3.5" />
      <path d="M11.5 14L23 3.5" />
    </svg>
  );
}

/**
 * A red "!" beside a message EZ Texting refused - Jeel, 2026-09-28, as a
 * phone shows it. The message never left, so it has no ticks. The server keeps
 * these (`db/failed-sends.ts`); before that a refused send was only a line in
 * the server log.
 */
function NotSentMark() {
  return (
    <svg className="convo__not-sent" width="18" height="18" viewBox="0 0 24 24" role="img" aria-label="Not sent">
      <title>Not sent - EZ Texting did not accept it</title>
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="M12 6.5v7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="17.25" r="1.5" fill="#fff" />
    </svg>
  );
}

/** The nearest ancestor that scrolls - the workspace's conversation card. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

export function Conversation({
  entries,
  leadFirstName,
}: {
  entries: TimelineEntry[];
  leadFirstName: string;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const shown = entries.filter((e) => SHOWN.has(e.kind));

  // An agent watching for a reply wants the newest in view; the timeline page
  // deliberately does not do this, so a reader is not jumped down the page.
  //
  // The box that scrolls is scrolled to its very end - 2026-09-29. This used
  // scrollIntoView on a marker after the last message, which stopped short by
  // the box's bottom padding, so the newest message's name and time sat below
  // the edge and a sent message looked as if it had not arrived.
  useEffect(() => {
    const box = scrollParent(bottom.current);
    if (box) box.scrollTop = box.scrollHeight;
  }, [shown.length]);

  if (shown.length === 0) {
    return <p className="convo__empty">No messages yet.</p>;
  }

  return (
    <div className="convo">
      {shown.map((entry, index) => {
        const at = new Date(entry.at);
        const time = formatTime(at);

        if (entry.kind === 'system') {
          return (
            <p className="convo__system" key={`${entry.at}-${index}`}>
              {systemText(entry.detail)} · {time}
            </p>
          );
        }

        if (entry.kind === 'call') {
          return (
            <div className="convo__call" key={`${entry.at}-${index}`}>
              <p className="convo__system">
                {callText(entry.detail)}
                {entry.author ? ` · ${entry.author}` : ''} · {time}
              </p>
              <CallTranscript detail={entry.detail} agentName={entry.author} leadName={leadFirstName} />
            </div>
          );
        }

        const body = typeof entry.detail.body === 'string' ? entry.detail.body : '';
        const failed = entry.detail.deliveryStatus === 'failed';

        if (entry.kind === 'inbound') {
          const label = replyLabel(entry);
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
            </p>
            <div className="convo__line">
              {failed && <NotSentMark />}
              <div
                className={`convo__bubble convo__bubble--out${
                  entry.kind === 'agent_sms' ? ' convo__bubble--agent' : ''
                }`}
              >
                {body}
                {!failed && (
                  <>
                    {/* Holds the ticks' space on the last line, so text never
                        runs underneath them. */}
                    <span className="convo__tick-space" aria-hidden="true" />
                    <SentTicks />
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
