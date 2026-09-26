import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { releaseLead } from '../api/leads';
import { usePolling } from '../api/usePolling';
import { getLead, getTimeline, markRead, type LeadDetail, type TimelineEntry } from '../api/workspace';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { Timeline } from '../components/Timeline';
import { ActionsPanel } from './workspace/ActionsPanel';
import { SmsCompose } from './workspace/SmsCompose';
import { formatAge, formatPhone, leadName } from '../lib/format';

/**
 * One lead, one screen: who they are, what they said, and every action an agent
 * can take without leaving the page. DESIGN-PROMPT.md 3. Phase 3 task 17.
 *
 * Three columns at >=1280px - card, timeline, actions - stacking below that.
 *
 * **The Call button is here and disabled.** Twilio is Phase 4, and CLAUDE.md
 * §10 asks for it visible but inert so the screen does not change shape later.
 * It says why it is disabled rather than sitting there dead.
 */

/** Ticks the age on the card, the same way the queue does. */
function useSecond(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const leadId = Number(id);
  const navigate = useNavigate();
  const now = useSecond();

  const [releasing, setReleasing] = useState(false);

  const valid = Number.isInteger(leadId) && leadId > 0;

  const fetcher = useCallback(() => getLead(leadId), [leadId]);
  const { data: lead, loading, error, refresh } = usePolling<LeadDetail>(fetcher, {
    enabled: valid,
  });

  // The timeline polls separately from the card. Both are cheap, and keeping
  // them apart means a slow timeline cannot hold up the card an agent is
  // reading while the phone rings.
  const timelineFetcher = useCallback(() => getTimeline(leadId), [leadId]);
  const { data: entries } = usePolling<TimelineEntry[]>(timelineFetcher, { enabled: valid });

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

  return (
    <section className="workspace">
      <div className="workspace__top">
        <Button variant="ghost" onClick={() => void backToQueue()} loading={releasing}>
          &larr; Back to queue
        </Button>
        <Link className="workspace__timeline-link" to={`/leads/${lead.id}/timeline`}>
          Full timeline
        </Link>
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
          Unclear replies - read the raw messages in the timeline before acting.
        </Banner>
      )}

      <div className="workspace__grid">
        <div className="workspace__col workspace__col--left">
          <article className="card lead-card">
            <header className="lead-card__head">
              <div>
                <h1 className="lead-card__name">{name}</h1>
                <p className="lead-card__phone tabular">{formatPhone(lead.phone)}</p>
              </div>
              <div className="lead-card__score">
                {tier && <span className={`tier tier--${tier.toLowerCase()}`}>{tier}</span>}
                <span className="lead-card__score-value tabular">{score}</span>
              </div>
            </header>

            <dl className="lead-card__facts">
              <div>
                <dt>Age</dt>
                <dd className="tabular">{formatAge(lead.receivedAt, now)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd className="mono">{lead.source ?? '-'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{lead.conversation?.status ?? 'No conversation'}</dd>
              </div>
            </dl>

            {lead.chips.length > 0 && (
              <ul className="chips">
                {lead.chips.map((chip) => (
                  <li key={chip.question} className={`chip${chip.answer ? '' : ' chip--empty'}`}>
                    <span className="chip__heading">{chip.heading}</span>
                    <span className="chip__answer">{chip.answer ?? '-'}</span>
                  </li>
                ))}
              </ul>
            )}

            {lead.breakdown.length > 0 && (
              <p className="lead-card__breakdown">
                {lead.breakdown.map((line) => `${line.label} +${line.points}`).join(' · ')}
              </p>
            )}

            <div className="lead-card__flags">
              {lead.flags.dnc && <Badge tone="muted">DNC</Badge>}
              {lead.flags.needsReview && <Badge tone="warning">Needs review</Badge>}
              {lead.flags.expired && <Badge tone="muted">Expired</Badge>}
              {lead.conversation?.agentTookOverAt && (
                <Badge tone="navy">Agent handling - questions stopped</Badge>
              )}
              {lead.claimedBy && <Badge tone="neutral">Held by {lead.claimedBy.name}</Badge>}
            </div>
          </article>

          <div className="card workspace__actions">
            {/* Phase 4. Visible but inert, so the screen keeps its shape and an
                agent can see that calling is coming rather than missing. */}
            <Button block size="lg" disabled title="Browser calling arrives with Twilio in Phase 4">
              Call {formatPhone(lead.phone)}
            </Button>
            <p className="workspace__call-note">
              {lead.flags.dnc
                ? 'Blocked: this number is on the do-not-call list.'
                : 'Browser calling is not switched on yet.'}
            </p>

            <SmsCompose lead={lead} refresh={refresh} />
          </div>
        </div>

        <div className="workspace__col workspace__col--center">
          <div className="card timeline-card">
            {entries ? (
              // Auto-scrolled here, unlike the timeline page: an agent on the
              // phone wants the newest reply in view.
              <Timeline entries={entries} autoScroll />
            ) : (
              <div className="workspace__pending">Loading the timeline...</div>
            )}
          </div>
        </div>

        <div className="workspace__col workspace__col--right">
          <ActionsPanel lead={lead} refresh={refresh} />
        </div>
      </div>
    </section>
  );
}
