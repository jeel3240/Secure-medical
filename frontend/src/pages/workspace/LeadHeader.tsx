import type { LeadDetail } from '../../api/workspace';
import { Button } from '../../components/Button';
import { TierSignal } from '../../components/TierSignal';
import { formatAge, formatPhone } from '../../lib/format';

/**
 * The workspace's full-width header card: who the lead is, then the two facts
 * an agent checks before calling - the score and how far the questions got -
 * and the two contact actions. Split out of WorkspacePage.tsx, 2026-09-28.
 *
 * **Redesigned plainer - Jeel, 2026-09-29.** The first version read as
 * generated: an initials circle, four tiny letter-spaced UPPERCASE labels, the
 * phone and "WEBINTERFACE" in monospace, a large red score, a coloured dot, a
 * dashed Call button and a "Phase 4" note agents have no reason to understand.
 * Now: the full name at heading size with the queue's tier bars, one quiet line
 * of phone, source and age, two facts with sentence-case labels in the body
 * face, and a plain disabled Call button that explains itself on hover.
 */

/** "WEBINTERFACE" -> "Web interface". EZ Texting's own words for how a contact arrived. */
export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const known: Record<string, string> = { WEBINTERFACE: 'Web interface', API: 'API' };
  return known[source.toUpperCase()] ?? source;
}

/**
 * How far the questions got, in the Step column's words (ADMIN-LEADS.md,
 * "Step"): the question they are on, or where they stopped.
 */
export function questionsLabel(conversation: LeadDetail['conversation']): string {
  if (!conversation) return 'Not started';
  const q = `Q${conversation.step ?? 1}`;
  switch (conversation.status) {
    case 'completed':
      return 'Completed';
    case 'open':
      return conversation.agentTookOverAt ? `Agent took over at ${q}` : `On ${q}`;
    case 'expired':
      return `Stopped at ${q}`;
    case 'review':
      return `Needs review at ${q}`;
    case 'suppressed':
      return 'Not sent - blocked';
    default:
      return conversation.status;
  }
}

function fullName(lead: LeadDetail): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ') || formatPhone(lead.phone);
}

export function LeadHeader({
  lead,
  mine,
  now,
  onSendSms,
}: {
  lead: LeadDetail;
  /** The viewer holds the lead - only then is Send SMS offered. */
  mine: boolean;
  now: Date;
  onSendSms: () => void;
}) {
  const score = lead.conversation?.score ?? 0;
  const source = sourceLabel(lead.source);
  const facts = [formatPhone(lead.phone), source, lead.receivedAt ? `${formatAge(lead.receivedAt, now)} ago` : null];

  return (
    <article className="card lead-head">
      <div className="lead-head__who">
        <div className="lead-head__title">
          <h1 className="lead-head__name">{fullName(lead)}</h1>
          {lead.conversation?.tier && <TierSignal tier={lead.conversation.tier} />}
        </div>
        <p className="lead-head__facts">
          {facts.filter(Boolean).map((fact, i) => (
            <span key={i} className={i === 0 ? 'tabular' : undefined}>
              {fact}
            </span>
          ))}
        </p>
      </div>

      <dl className="lead-head__stats">
        <div>
          <dt>Score</dt>
          <dd className="tabular">
            {score}
            <span className="lead-head__of"> / 100</span>
          </dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>{questionsLabel(lead.conversation)}</dd>
        </div>
      </dl>

      <div className="lead-head__buttons">
        {mine && !lead.flags.dnc && (
          <Button variant="secondary" onClick={onSendSms}>
            Send SMS
          </Button>
        )}
        {/* Twilio calling is Phase 4. Visible but inert, so the screen keeps its
            shape; the reason is a tooltip, not a line agents have to read. */}
        <Button
          variant="secondary"
          disabled
          title={
            lead.flags.dnc
              ? 'This number is on the do-not-call list.'
              : 'Calling from the browser is not available yet.'
          }
        >
          Call
        </Button>
      </div>
    </article>
  );
}
