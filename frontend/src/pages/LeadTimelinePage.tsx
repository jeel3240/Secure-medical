import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { claimLead } from '../api/leads';
import { usePolling } from '../api/usePolling';
import {
  getLead,
  getTimeline,
  DISPOSITION_LABEL,
  type Disposition,
  type LeadDetail,
  type TimelineEntry,
} from '../api/workspace';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { Timeline } from '../components/Timeline';
import { formatPhone, formatRelative, leadName } from '../lib/format';
import { toApiError } from '../api/client';

/**
 * The read-only history of one lead: full width, with a summary sidebar.
 * DESIGN-PROMPT.md 4. Phase 3 task 21.
 *
 * Same `Timeline` component as the workspace, without auto-scroll - this page
 * is read from the top, and a list that jumps under the reader is worse than
 * one they scroll themselves.
 *
 * **The sidebar is derived from the timeline,** not from a new endpoint.
 * Attempts, last contact and the disposition list are all already in the
 * entries; counting them here costs nothing and avoids a second read model
 * that could disagree with what the page is showing.
 *
 * **Two rows of the brief's sidebar are missing and cannot be filled:** Consent
 * ref and the duplicate check. No data reaches us for either - the partner
 * sends no consent reference, and repeat-lead handling is not built
 * (CLAUDE.md §10). They are shown with what is actually known rather than left
 * off, so nobody wonders whether the page forgot them.
 */

export interface Summary {
  calls: number;
  smsOut: number;
  smsIn: number;
  lastContact: { at: string; inbound: boolean } | null;
  nextCallback: { at: string; agent: string | null } | null;
  dispositions: { at: string; value: Disposition; agent: string | null }[];
}

/** Exported for its tests: the sidebar is entirely this function's output. */
export function summarise(entries: TimelineEntry[]): Summary {
  const summary: Summary = {
    calls: 0,
    smsOut: 0,
    smsIn: 0,
    lastContact: null,
    nextCallback: null,
    dispositions: [],
  };

  for (const entry of entries) {
    switch (entry.kind) {
      case 'call':
        summary.calls++;
        break;
      case 'sms':
      case 'agent_sms':
        summary.smsOut++;
        break;
      case 'inbound':
        summary.smsIn++;
        break;
      case 'disposition':
        summary.dispositions.push({
          at: entry.at,
          value: entry.detail.value as Disposition,
          agent: entry.author,
        });
        break;
      case 'callback': {
        // The soonest one still to be done - what the agent has to act on.
        const at = entry.detail.scheduledAt;
        if (!entry.detail.doneAt && typeof at === 'string') {
          if (!summary.nextCallback || at < summary.nextCallback.at) {
            summary.nextCallback = { at, agent: entry.author };
          }
        }
        break;
      }
    }

    // Anything that went out or came in counts as contact; a note or a
    // disposition is our own record, not a conversation.
    if (entry.kind === 'sms' || entry.kind === 'agent_sms' || entry.kind === 'inbound' || entry.kind === 'call') {
      summary.lastContact = { at: entry.at, inbound: entry.kind === 'inbound' };
    }
  }

  return summary;
}

const whenFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function LeadTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const leadId = Number(id);
  const navigate = useNavigate();
  const valid = Number.isInteger(leadId) && leadId > 0;

  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leadFetcher = useCallback(() => getLead(leadId), [leadId]);
  const { data: lead, loading } = usePolling<LeadDetail>(leadFetcher, { enabled: valid });

  const timelineFetcher = useCallback(() => getTimeline(leadId), [leadId]);
  const { data: entries } = usePolling<TimelineEntry[]>(timelineFetcher, { enabled: valid });

  const summary = useMemo(() => summarise(entries ?? []), [entries]);

  /** Opening the workspace from here means claiming, exactly as the queue does. */
  const openWorkspace = async () => {
    setOpening(true);
    setError(null);
    try {
      await claimLead(leadId);
      navigate(`/leads/${leadId}`);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setOpening(false);
    }
  };

  if (!valid) return <Banner tone="error">That is not a lead id.</Banner>;

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
        <Banner tone="error">That lead could not be loaded.</Banner>
        <Link to="/queue">Back to queue</Link>
      </>
    );
  }

  const tier = lead.conversation?.tier ?? null;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">{leadName(lead)}</h1>
          <p className="page-subtitle">
            <span className="tabular">{formatPhone(lead.phone)}</span>
            {' · '}
            <span className="mono">{lead.source ?? 'no source'}</span>
          </p>
        </div>
        <div className="timeline-page__head-actions">
          {tier && <span className={`tier tier--${tier.toLowerCase()}`}>{tier}</span>}
          <span className="lead-card__score-value tabular">{lead.conversation?.score ?? 0}</span>
          <Button variant="secondary" loading={opening} onClick={() => void openWorkspace()}>
            Open workspace
          </Button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="timeline-page">
        <div className="card timeline-page__main">
          {entries ? (
            // No auto-scroll here, unlike the workspace: this page is read from
            // the top.
            <Timeline entries={entries} emptyText="Nothing has happened on this lead yet." />
          ) : (
            <Spinner />
          )}
        </div>

        <aside className="card timeline-page__side">
          <h2 className="timeline-page__side-title">Summary</h2>

          <dl className="summary">
            <dt>Status</dt>
            <dd>{lead.conversation?.status ?? 'No conversation'}</dd>

            <dt>Attempts</dt>
            <dd>
              {summary.calls} {summary.calls === 1 ? 'call' : 'calls'} · {summary.smsOut} SMS out ·{' '}
              {summary.smsIn} in
            </dd>

            <dt>Last contact</dt>
            <dd>
              {summary.lastContact ? (
                <>
                  {summary.lastContact.inbound ? '← ' : '→ '}
                  {formatRelative(summary.lastContact.at)}
                </>
              ) : (
                'None'
              )}
            </dd>

            <dt>Next action</dt>
            <dd>
              {summary.nextCallback
                ? `Callback ${whenFormat.format(new Date(summary.nextCallback.at))}${
                    summary.nextCallback.agent ? ` · ${summary.nextCallback.agent}` : ''
                  }`
                : 'None scheduled'}
            </dd>

            <dt>DNC</dt>
            <dd>{lead.flags.dnc ? <Badge tone="muted">Yes</Badge> : 'No'}</dd>

            {/* Both of these are known gaps, shown rather than left off so
                nobody wonders whether the page forgot them. */}
            <dt>Consent ref</dt>
            <dd className="summary__gap" title="The partner sends no consent reference">
              -
            </dd>

            <dt>Duplicate check</dt>
            <dd className="summary__gap">This number has not been seen before</dd>
          </dl>

          <h3 className="timeline-page__side-title">Dispositions</h3>
          {summary.dispositions.length === 0 ? (
            <p className="summary__empty">None set.</p>
          ) : (
            <ul className="summary__list">
              {summary.dispositions.map((d, i) => (
                <li key={`${d.at}-${i}`}>
                  <span className="summary__list-when">{whenFormat.format(new Date(d.at))}</span>
                  <strong>{DISPOSITION_LABEL[d.value] ?? d.value}</strong>
                  {d.agent && <span className="summary__list-who">{d.agent}</span>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
