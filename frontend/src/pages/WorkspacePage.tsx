import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toApiError } from '../api/client';
import { claimLead, listQueue, releaseLead } from '../api/leads';
import { usePolling } from '../api/usePolling';
import { getLead, getTimeline, markRead, type LeadDetail, type TimelineEntry } from '../api/workspace';
import { useAuth } from '../auth/store';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { ActionsPanel } from './workspace/ActionsPanel';
import { Conversation } from './workspace/Conversation';
import { LeadAnswers } from './workspace/LeadAnswers';
import { CallBar } from './workspace/CallBar';
import { LeadHeader } from './workspace/LeadHeader';
import { LeadNotes } from './workspace/LeadNotes';
import { SmsCompose } from './workspace/SmsCompose';
import { useLeadCall } from './workspace/useLeadCall';
import { formatTime, leadName } from '../lib/format';
import { useIncomingCall } from '../lib/incoming-call';
import { useSecond } from '../lib/useSecond';

/**
 * One lead, one screen: who they are, what they said, and every action an agent
 * can take without leaving the page. DESIGN-PROMPT.md 3. Phase 3 task 17,
 * redesigned 2026-09-28 to the mockup Jeel supplied.
 *
 * The shape is a full-width header - who, score, age, source, flow state, and
 * the two contact actions - over three columns: what the lead told us, the
 * conversation, and the wrap-up. `FRONTEND.md` records what changed and why.
 *
 * **One page for every lead, picked or not - Jeel, 2026-09-28.** Opening a
 * lead to look at it and picking it used to land on two different pages. Now
 * both land here, and the only difference is whether the actions work: on a
 * lead you hold they do; on any other they are switched off, with Pick right
 * there. The server refuses a write from anyone who does not hold the lead, so
 * the switched-off controls are a courtesy, not the lock - AGENT-WORKSPACE.md.
 *
 * A call, once placed, is in `workspace/CallBar.tsx`, docked at the foot of the
 * screen. The header card is `workspace/LeadHeader.tsx`, the left column
 * `workspace/LeadAnswers.tsx` and `workspace/LeadNotes.tsx`, the SMS box `SmsCompose.tsx` and the wrap-up
 * `ActionsPanel.tsx`. This page holds the data, picking and releasing, and the
 * layout.
 */

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const leadId = Number(id);
  const navigate = useNavigate();
  const now = useSecond();
  const me = useAuth((s) => s.user);

  const [releasing, setReleasing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
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
  const { data: entries, refresh: refreshTimeline } = usePolling<TimelineEntry[]>(timelineFetcher, {
    enabled: valid,
  });

  // After a write: the card, and the timeline too, so a saved note shows in the
  // Notes card and a sent text in the thread at once, not on the next poll.
  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshTimeline()]);
  }, [refresh, refreshTimeline]);

  // This lead's call. Owned here because two parts of the page use it: the
  // header's Call button starts it, and the call bar at the foot of the screen
  // shows it. Leaving the lead ends the call - `useLeadCall`.
  const reloadAfterCall = useCallback(() => void refreshAll(), [refreshAll]);
  const call = useLeadCall(leadId, reloadAfterCall);
  // An answered incoming call's bar sits in the same place; the page leaves it room too.
  const incomingBar = useIncomingCall((s) => s.state.phase === 'call');

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

  const mine = Boolean(lead?.claimedBy && me && lead.claimedBy.id === me.id);

  /**
   * Working the lead is what clears the unread flag - CLAUDE.md §10. Only once
   * it is yours: looking at a lead is not handling it, and marking the reply
   * read is what lets an expired lead leave the queue, so a glance must not do
   * it. Fired only while the flag is set, so a poll every five seconds does not
   * post it again and again.
   */
  useEffect(() => {
    if (mine && lead?.flags.unread) {
      // A failure is left to the next poll, which fires this again while the
      // flag is still set; it must not surface as an uncaught error.
      markRead(lead.id)
        .then(refresh)
        .catch(() => undefined);
    }
  }, [mine, lead?.id, lead?.flags.unread, refresh]);

  /**
   * Arrived from a missed call's **Call back** (`layout/IncomingCall.tsx`):
   * dial as soon as the lead is theirs. Once - the flag is taken off the
   * history entry, so a reload or Back does not ring the lead again. If
   * someone else holds the lead, nothing is dialled and the page says who.
   */
  const location = useLocation();
  const callBack = Boolean((location.state as { callBack?: boolean } | null)?.callBack);
  const startCall = call.start;
  useEffect(() => {
    if (!callBack || !lead) return;
    navigate(location.pathname, { replace: true, state: null });
    if (mine && !lead.flags.dnc) startCall();
  }, [callBack, lead, mine, startCall, navigate, location.pathname]);

  /** Pick from inside the page: the lead becomes yours and the actions wake up. */
  const pick = async () => {
    setPicking(true);
    setPickError(null);
    try {
      await claimLead(leadId);
    } catch (err) {
      // Someone was first - their name is in the message, and the refresh
      // below turns this page into their lead, read-only.
      setPickError(toApiError(err).message);
    } finally {
      await refresh();
      setPicking(false);
    }
  };

  /**
   * Releases the claim on the way out, so the lead is not left locked - but
   * only a claim that is yours. A superadmin looking at someone else's lead
   * would otherwise take it off them just by leaving.
   */
  const backToQueue = async () => {
    setReleasing(true);
    try {
      if (mine) await releaseLead(leadId);
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
      <div className="loading-block">
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

  const held = lead.claimedBy;
  const messageCount = (entries ?? []).filter(
    (e) => e.kind === 'sms' || e.kind === 'inbound' || e.kind === 'agent_sms'
  ).length;

  return (
    <section className={`workspace${call.state.phase === 'idle' && !incomingBar ? '' : ' workspace--call-bar'}`}>
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
            Held by {mine ? 'you' : held.name} · since {formatTime(new Date(held.at))}
          </span>
        )}
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}
      {pickError && <Banner tone="error">{pickError}</Banner>}

      {!mine && (
        <div className={`workspace__viewing${held ? ' workspace__viewing--held' : ''}`}>
          <span>
            {held
              ? `${held.name} is working this lead. You can look, but not act on it.`
              : lead.closed
                ? 'This lead is closed. Pick it up only to work it again.'
                : 'You are viewing this lead. Pick it up to text them or record an outcome.'}
          </span>
          {!held && (
            <Button loading={picking} onClick={() => void pick()}>
              Pick up
            </Button>
          )}
        </div>
      )}

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

      <LeadHeader lead={lead} mine={mine} now={now} call={call} />

      <div className="workspace__flags">
        {lead.closed && <Badge tone="muted">Closed</Badge>}
        {lead.flags.dnc && <Badge tone="muted">DNC</Badge>}
        {/* The queue's own words for it. A badge, like every other state of
            the lead - not a sentence across the page. */}
        {lead.flags.missedCall && <Badge tone="warning">Missed call</Badge>}
        {lead.flags.needsReview && <Badge tone="warning">Needs review</Badge>}
        {lead.flags.expired && <Badge tone="muted">Expired</Badge>}
        {lead.conversation?.agentTookOverAt && (
          <Badge tone="navy">Agent handling - questions stopped</Badge>
        )}
      </div>

      <div className="workspace__grid">
        <div className="workspace__col workspace__col--left">
          <LeadAnswers lead={lead} />
          <LeadNotes entries={entries} />
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
                  leadFirstName={lead.firstName ?? 'Lead'}
                />
              ) : (
                <div className="workspace__pending">Loading the conversation...</div>
              )}
            </div>

            <SmsCompose lead={lead} refresh={refreshAll} canAct={mine} />
          </article>
        </div>

        <div className="workspace__col workspace__col--right">
          <ActionsPanel lead={lead} refresh={refreshAll} canAct={mine} />
        </div>
      </div>
      <CallBar
        who={{ leadId: lead.id, name: leadName(lead), phone: lead.phone }}
        call={call}
        now={now}
        onNoteSaved={reloadAfterCall}
      />
    </section>
  );
}
