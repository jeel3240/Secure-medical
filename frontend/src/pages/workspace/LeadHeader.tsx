import type { LeadDetail } from '../../api/workspace';
import { formatAge, formatPhone } from '../../lib/format';
import { CallControl } from './CallControl';
import type { LeadCall } from './useLeadCall';

/**
 * The workspace's full-width header card: who the lead is, then the two facts
 * an agent checks before calling - the score and how far the questions got -
 * and the two contact actions. Split out of WorkspacePage.tsx, 2026-09-28.
 *
 * **Redesigned plainer - Jeel, 2026-09-29.** The first version read as
 * generated: an initials circle, four tiny letter-spaced UPPERCASE labels, the
 * phone and "WEBINTERFACE" in monospace, a large red score, a coloured dot, a
 * dashed Call button and a "Phase 4" note agents have no reason to understand.
 * Now: the full name at heading size, one quiet line of phone, source and age,
 * two facts with sentence-case labels in the body face, and a plain disabled
 * Call button that explains itself on hover.
 *
 * **The Call button is real - Phase 4.** It was a greyed-out placeholder until
 * browser calling was built; it is now `CallControl.tsx`. Once pressed, the
 * call itself is in the call bar at the foot of the screen, `CallBar.tsx`.
 *
 * **No tier and no Send SMS - Jeel, the same day.** The score beside it already
 * says how strong the lead is, and Send SMS only moved the cursor to the
 * message box that sits right under the header.
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
  // The question's own name from the server - "Q2", or "Offers" for the one
  // asked of a lead who said No, which sits fourth and is not their "Q4".
  const q = conversation.question ?? `Q${conversation.step ?? 1}`;
  switch (conversation.status) {
    case 'completed':
      // A lead who said No ends on the offers question, not on the last one.
      if (conversation.endOutcome === 'offers') return 'Offers only';
      if (conversation.endOutcome === 'wants_contact') return 'Wants a call';
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
  call,
}: {
  lead: LeadDetail;
  /** The viewer holds the lead - only then may they call it. */
  mine: boolean;
  now: Date;
  /** This lead's call - owned by the page, which also shows it in the call bar. */
  call: LeadCall;
}) {
  const score = lead.conversation?.score ?? 0;
  const source = sourceLabel(lead.source);
  const facts = [formatPhone(lead.phone), source, lead.receivedAt ? `${formatAge(lead.receivedAt, now)} ago` : null];

  return (
    <article className="card lead-head">
      <div className="lead-head__who">
        <h1 className="lead-head__name">{fullName(lead)}</h1>
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
        <CallControl lead={lead} mine={mine} call={call} />
      </div>
    </article>
  );
}
