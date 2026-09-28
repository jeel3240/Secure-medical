import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { listQueue, releaseLead } from '../api/leads';
import { usePolling } from '../api/usePolling';
import { getLead, getTimeline, markRead, type LeadDetail, type TimelineEntry } from '../api/workspace';
import { useAuth } from '../auth/store';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { ActionsPanel } from './workspace/ActionsPanel';
import { Conversation } from './workspace/Conversation';
import { SmsCompose } from './workspace/SmsCompose';
import { formatAge, formatPhone, leadName } from '../lib/format';

/**
 * One lead, one screen: who they are, what they said, and every action an agent
 * can take without leaving the page. DESIGN-PROMPT.md 3. Phase 3 task 17,
 * redesigned 2026-09-28 to the mockup Jeel supplied.
 *
 * The shape is a full-width header - who, score, age, source, flow state, and
 * the two contact actions - over three columns: what the lead told us, the
 * conversation, and the wrap-up. `FRONTEND.md` records what changed and why.
 *
 * **The Call button is here and disabled.** Twilio is Phase 4, and CLAUDE.md
 * §10 asks for it visible but inert so the screen does not change shape later.
 * It says why it is off rather than sitting there dead.
 */

/** Ticks the age in the header, the same way the queue does. */
function useSecond(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** `Maria Reyes` -> `MR`, `Maria` -> `M`. */
function initials(lead: LeadDetail): string {
  return [lead.firstName, lead.lastName]
    .filter(Boolean)
    .map((part) => (part as string).trim()[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The breakdown in the mockup's words. The API's labels are the bare answer -
 * "Both", "Today" - which reads fine on a chip but is ambiguous in a list of
 * points: "Today +30" does not say what was asked. Q3 stays bare because its
 * answers already say what they are ("Call me now").
 */
function breakdownLabel(code: string, label: string): string {
  if (code === 'responded') return 'Responded to SMS';
  if (code === 'completed') return 'Completed flow';
  if (code.startsWith('q1_')) return `Interest: ${label}`;
  if (code.startsWith('q2_')) return `Timing: ${label}`;
  return label;
}

/** `open` -> `Open`, `completed` -> `Completed`. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, ' ');
}

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const leadId = Number(id);
  const navigate = useNavigate();
  const now = useSecond();
  const me = useAuth((s) => s.user);

  const [releasing, setReleasing] = useState(false);
  const [focusCompose, setFocusCompose] = useState(0);
  const [place, setPlace] = useState<{ index: number; total: number } | null>(null);

  const valid = Number.isInteger(leadId) && leadId > 0;

  const fetcher = useCallback(() => getLead(leadId), [leadId]);
  const { data: lead, loading, error, refresh } = usePolling<LeadDetail>(fetcher, {
    enabled: valid,
  });

  // The conversation polls separately from the header. Both are cheap, and
  // keeping them apart means a slow thread cannot hold up the card an agent is
  // reading while the phone rings.
  const timelineFetcher = useCallback(() => getTimeline(leadId), [leadId]);
  const { data: entries } = usePolling<TimelineEntry[]>(timelineFetcher, { enabled: valid });

  /**
   * "Lead 3 of 12" - where this one sits in the queue an agent is working
   * down. Fetched once rather than polled: it is orientation, not live data,
   * and a number that shuffled under the reader would be worse than a stale
   * one. Absent when the lead is not in the queue at all, which is normal -
   * opening it may have been what took it out.
   */
  useEffect(() => {
    if (!valid) return;
    let alive = true;
    void listQueue()
      .then((queue) => {
        if (!alive) return;
        const index = queue.leads.findIndex((l) => l.id === leadId);
        setPlace(index >= 0 ? { index: index + 1, total: queue.total } : null);
      })
      .catch(() => setPlace(null));
    return () => {
      alive = false;
    };
  }, [leadId, valid]);

  /**
   * Opening the lead is what clears the unread flag - CLAUDE.md §10. Fired once
   * the lead loads and only while the flag is set, so a poll every five seconds
   * does not post it again and again.
   */
  useEffect(() => {
    if (lead?.flags.unread) {
      void markRead(lead.id).then(refresh);
    }
  }, [lead?.id, lead?.flags.unread, refresh]);

  /** Releases the claim on the way out, so the lead is not left locked. */
  const backToQueue = async () => {
    setReleasing(true);
    try {
      await releaseLead(leadId);
    } catch {
      // A failed release must not trap the agent on the screen. The claim is
      // visible to a superadmin, who can force-release it.
    } finally {
      navigate('/queue');
    }
  };

  if (!Number.isInteger(leadId) || leadId < 1) {
    return <Banner tone="error">That is not a lead id.</Banner>;
  }

  if (loading) {
    return (
      <div className="leads__loading">
        <Spinner />
      </div>
    );
  }

  if (!lead) {
    return (
      <>
        <Banner tone="error">{error ?? 'That lead could not be loaded.'}</Banner>
        <Link to="/queue">Back to queue</Link>
      </>
    );
  }

  const name = leadName(lead);
  const score = lead.conversation?.score ?? 0;
  const tier = lead.conversation?.tier ?? null;
  const held = lead.claimedBy;
  const heldByMe = Boolean(held && me && held.id === me.id);
  const messageCount = (entries ?? []).filter(
    (e) => e.kind === 'sms' || e.kind === 'inbound' || e.kind === 'agent_sms'
  ).length;

  return (
    <section className="workspace">
      <div className="workspace__top">
        <div className="workspace__top-left">
          <Button variant="ghost" onClick={() => void backToQueue()} loading={releasing}>
            &larr; Back to queue
          </Button>
          {place && (
            <span className="workspace__place">
              Lead {place.index} of {place.total}
            </span>
          )}
        </div>
        {held && (
          <span className="workspace__held">
            <span className="workspace__held-dot" aria-hidden="true" />
            Held by {heldByMe ? 'you' : held.name} · since {timeFormat.format(new Date(held.at))}
          </span>
        )}
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}

      {/* A blocked number stops every action, not just SMS - the flag is what
          the disposition and compose controls read. */}
      {lead.flags.dnc && (
        <Banner tone="error">
          This number is on the do-not-call list. Calling and texting are blocked.
        </Banner>
      )}
      {lead.flags.needsReview && (
        <Banner tone="warning">
          Unclear replies - read the raw messages below before acting.
        </Banner>
      )}

      <article className="card lead-head">
        <div className="lead-head__who">
          <span className="lead-head__avatar" aria-hidden="true">
            {initials(lead)}
          </span>
          <div>
            <h1 className="lead-head__name">
              {name}
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
            {!lead.flags.dnc && (
              <Button variant="secondary" onClick={() => setFocusCompose((n) => n + 1)}>
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

      <div className="workspace__flags">
        {lead.flags.dnc && <Badge tone="muted">DNC</Badge>}
        {lead.flags.needsReview && <Badge tone="warning">Needs review</Badge>}
        {lead.flags.expired && <Badge tone="muted">Expired</Badge>}
        {lead.conversation?.agentTookOverAt && (
          <Badge tone="navy">Agent handling - questions stopped</Badge>
        )}
      </div>

      <div className="workspace__grid">
        <div className="workspace__col workspace__col--left">
          <article className="card told-us">
            <h2 className="card__title">What {lead.firstName ?? 'the lead'} told us</h2>
            <dl className="told-us__list">
              {lead.chips.map((chip) => (
                <div key={chip.question}>
                  <dt>{chip.heading}</dt>
                  <dd>
                    {chip.answer ? (
                      <span className={`answer answer--q${chip.question}`}>{chip.answer}</span>
                    ) : (
                      <span className="answer answer--empty">-</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </article>

          {lead.breakdown.length > 0 && (
            <article className="card breakdown">
              <h2 className="card__title">
                Score breakdown
                <span className={`breakdown__total tabular${tier ? ` breakdown__total--${tier.toLowerCase()}` : ''}`}>
                  {score}
                </span>
              </h2>

              {/* One segment per line, sized by what it contributed - the shape
                  of the score at a glance, before reading the numbers. */}
              <div
                className="breakdown__bar"
                role="img"
                aria-label={`Score ${score} of 100`}
              >
                {lead.breakdown.map((line, i) => (
                  <span
                    key={line.code}
                    className="breakdown__seg"
                    style={{ flexGrow: line.points, opacity: 0.45 + i * 0.14 }}
                  />
                ))}
              </div>

              <ul className="breakdown__list">
                {lead.breakdown.map((line, i) => (
                  <li key={line.code}>
                    <span className="breakdown__swatch" style={{ opacity: 0.45 + i * 0.14 }} />
                    <span className="breakdown__label">{breakdownLabel(line.code, line.label)}</span>
                    <span className="breakdown__points tabular">+{line.points}</span>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </div>

        <div className="workspace__col workspace__col--center">
          <article className="card convo-card">
            <header className="convo-card__head">
              <h2 className="card__title">
                Conversation
                <span className="convo-card__count">
                  {messageCount} {messageCount === 1 ? 'message' : 'messages'} · SMS
                </span>
              </h2>
              <Link className="convo-card__link" to={`/leads/${lead.id}/timeline`}>
                Full timeline &rarr;
              </Link>
            </header>

            <div className="convo-card__body">
              {entries ? (
                <Conversation
                  entries={entries}
                  chips={lead.chips}
                  leadFirstName={lead.firstName ?? 'Lead'}
                />
              ) : (
                <div className="workspace__pending">Loading the conversation...</div>
              )}
            </div>

            <SmsCompose lead={lead} refresh={refresh} focusKey={focusCompose} />
          </article>
        </div>

        <div className="workspace__col workspace__col--right">
          <ActionsPanel lead={lead} refresh={refresh} />
        </div>
      </div>
    </section>
  );
}
