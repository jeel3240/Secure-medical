import type { LeadDetail } from '../../api/workspace';
import { Button } from '../../components/Button';
import { formatAge, formatPhone, leadName } from '../../lib/format';

/**
 * The workspace's full-width header card: who the lead is, the score, age,
 * source and SMS flow state, and the two contact actions. Split out of
 * WorkspacePage.tsx, 2026-09-28.
 *
 * **The Call button is here and disabled.** Twilio is Phase 4, and CLAUDE.md
 * §10 asks for it visible but inert so the screen does not change shape later.
 * It says why it is off rather than sitting there dead.
 */

/** `Maria Reyes` -> `MR`, `Maria` -> `M`. */
function initials(lead: LeadDetail): string {
  return [lead.firstName, lead.lastName]
    .filter(Boolean)
    .map((part) => (part as string).trim()[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

/** `open` -> `Open`, `completed` -> `Completed`. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, ' ');
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
  const tier = lead.conversation?.tier ?? null;

  return (
    <article className="card lead-head">
      <div className="lead-head__who">
        <span className="lead-head__avatar" aria-hidden="true">
          {initials(lead)}
        </span>
        <div>
          <h1 className="lead-head__name">
            {leadName(lead)}
            {tier && <span className={`tier tier--${tier.toLowerCase()}`}>{tier}</span>}
          </h1>
          <p className="lead-head__phone tabular">{formatPhone(lead.phone)}</p>
        </div>
      </div>

      <dl className="lead-head__stats">
        <div>
          <dt>Score</dt>
          <dd>
            <span className={`lead-head__score tabular${tier ? ` lead-head__score--${tier.toLowerCase()}` : ''}`}>
              {score}
            </span>
            <span className="lead-head__of">/100</span>
          </dd>
        </div>
        <div>
          <dt>Lead age</dt>
          <dd className="tabular">{formatAge(lead.receivedAt, now)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd className="mono">{lead.source ?? '-'}</dd>
        </div>
        <div>
          <dt>SMS flow</dt>
          <dd>
            <span className={`flow flow--${lead.conversation?.status ?? 'none'}`}>
              {lead.conversation ? sentenceCase(lead.conversation.status) : 'No conversation'}
            </span>
          </dd>
        </div>
      </dl>

      <div className="lead-head__actions">
        <div className="lead-head__buttons">
          {mine && !lead.flags.dnc && (
            <Button variant="secondary" onClick={onSendSms}>
              Send SMS
            </Button>
          )}
          {/* Phase 4. Visible but inert, so the screen keeps its shape and an
              agent can see that calling is coming rather than missing. */}
          <Button
            variant="secondary"
            className="lead-head__call"
            disabled
            title="Browser calling arrives with Twilio in Phase 4"
          >
            Call {formatPhone(lead.phone)}
          </Button>
        </div>
        <p className="lead-head__call-note">
          {lead.flags.dnc
            ? 'Blocked: this number is on the do-not-call list.'
            : 'Browser calling is off until Phase 4.'}
        </p>
      </div>
    </article>
  );
}
