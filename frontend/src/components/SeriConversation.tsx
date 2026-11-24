import { formatDay, formatTime } from '../lib/format';

/**
 * What the lead said to Seri, under the robot's call - A19, docs/AI-AGENT.md
 * section 9. For the agent who takes the transfer or the call back, so the
 * lead does not repeat themselves: each line, Lead or Seri, in the order said,
 * then how her part ended - "Booked a call back: Mon, Nov 16 3:00 PM", or
 * "Seri stopped - the call went on with the script" when she failed.
 *
 * Closed by default, like the answers and the transcript beside it, whose
 * look it shares. Shared by the workspace conversation and the Lead Timeline.
 * Nothing for a call she did not take.
 */

/** One line of hers or the lead's, as the server sends it (`db/timeline.ts`, `seriPart`). */
export interface SeriTurn {
  who: 'lead' | 'seri';
  text: string;
}

/** How her part ended - the action she ended with (`Handoff`, backend `ai/actions.ts`), or null. */
export interface SeriEnded {
  action: string;
  reason?: string;
  why?: string;
  /** A call back's time, ISO. */
  at?: string;
}

const END_CALL: Record<string, string> = {
  not_interested: 'Ended - not interested',
  wrong_person: 'Ended - wrong person',
  emergency: 'Ended - told to call 911',
  no_response: 'Ended - no response',
  time_limit: 'Ended - three minutes up',
};

/** How her part ended, in words. Null when she ended with nothing - the lead hung up, or a machine answered. */
export function seriEndedText(ended: SeriEnded | null): string | null {
  if (!ended) return null;
  switch (ended.action) {
    case 'transfer_to_agent':
      return 'Put through to a person';
    case 'book_callback': {
      const at = ended.at ? new Date(ended.at) : null;
      return at ? `Booked a call back: ${formatDay(at)} ${formatTime(at)}` : 'Booked a call back';
    }
    case 'send_link':
      return 'Texted the link';
    case 'opt_out':
      return 'Asked not to be called - number blocked';
    case 'end_call':
      return END_CALL[ended.reason ?? ''] ?? 'Ended';
    case 'fallback':
      return 'Seri stopped - the call went on with the script';
    default:
      return null;
  }
}

export function SeriConversation({ detail }: { detail: Record<string, unknown> }) {
  const seri = detail.seri as { turns?: SeriTurn[]; ended?: SeriEnded | null } | undefined;
  if (!seri) return null;
  const turns = Array.isArray(seri.turns) ? seri.turns : [];
  const ended = seriEndedText(seri.ended ?? null);
  if (turns.length === 0 && !ended) return null;
  return (
    <details className="transcript">
      <summary>Seri</summary>
      <ol className="transcript__lines">
        {turns.map((turn, i) => (
          <li key={i} className={`transcript__line transcript__line--${turn.who}`}>
            <span className="transcript__speaker">{turn.who === 'lead' ? 'Lead' : 'Seri'}</span>
            {turn.text}
          </li>
        ))}
        {ended && <li className="transcript__line transcript__state">{ended}</li>}
      </ol>
    </details>
  );
}
