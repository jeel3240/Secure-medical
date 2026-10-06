import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toApiError } from '../api/client';
import { claimLead, listQueue, type QueueLead, type QueueResponse } from '../api/leads';
import { usePolling } from '../api/usePolling';
import { useAuth } from '../auth/store';
import { Banner } from '../components/Banner';
import { LiveStatus } from '../components/LiveStatus';
import { Button } from '../components/Button';
import { LockIcon } from '../components/LockIcon';
import { QueueStatus } from '../components/QueueStatus';
import { Segmented } from '../components/Segmented';
import { TierSignal } from '../components/TierSignal';
import { Spinner } from '../components/Spinner';
import { formatAge, formatPhone, leadName } from '../lib/format';
import { useSecond } from '../lib/useSecond';
import { rowAction } from '../lib/lock';

/**
 * The agents' landing screen: every responder, highest score first.
 *
 * DESIGN-PROMPT.md 2 for the layout, QUEUE.md for what the endpoint returns and
 * which leads are in it. Phase 3 tasks 15 and 16.
 *
 * **No STATE column.** The mockup has one, but EZ Texting sends no state with a
 * contact - `EZTEXTING-API.md` - so every row would read "-" forever. Left out
 * rather than given permanent space in a table the brief asks to keep dense.
 * Decided 2026-09-26; if the partner ever sends state it goes back in.
 *
 * **Redesigned 2026-09-28 to Jeel's mockup.** One card holding the filters and
 * the table, a segmented tier switcher, tiers as signal bars, statuses as a
 * mark and words instead of coloured pills, and every waiting time in the
 * same weight and colour. Colour is kept for what needs a person first.
 * FRONTEND.md.
 *
 * **No paging.** The endpoint truncates at 100 and says so; at 50-100 leads a
 * day that holds several days of queue. `total` drives the note when it bites.
 */

/** The tier switcher. One choice at a time, including all of them. */
const TIER_OPTIONS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'HOT', label: 'Hot' },
  { key: 'WARM', label: 'Warm' },
  { key: 'LOW', label: 'Low' },
];

/** What a blank cell shows. A plain hyphen - Jeel, 2026-09-28. */
const EMPTY = '-';

/**
 * A lead's answers in one cell: "Yes · No · Talk to an agent". One column, not
 * one per question - flows differ in how many questions they ask (FLOWS.md),
 * so there is no fixed set of columns to have. Hovering names each question.
 */
export function answersText(answers: QueueLead['answers']): string {
  return answers.length > 0 ? answers.map((a) => a.label).join(' · ') : EMPTY;
}

export function answersTitle(answers: QueueLead['answers']): string | undefined {
  return answers.length > 0 ? answers.map((a) => `${a.heading}: ${a.label}`).join('\n') : undefined;
}

const SINCE: { key: string; label: string }[] = [
  { key: '1h', label: 'Last hour' },
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'all', label: 'All time' },
];

export function QueuePage() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const now = useSecond();

  const [tier, setTier] = useState('');
  const [source, setSource] = useState('');
  const [since, setSince] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [claiming, setClaiming] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const fetcher = useCallback(
    () =>
      listQueue({
        tier: tier ? [tier] : undefined,
        source: source ? [source] : undefined,
        since,
        q: query || undefined,
      }),
    [tier, source, since, query]
  );

  const { data, loading, error, refresh, updatedAt, switching } = usePolling<QueueResponse>(fetcher, {
    // The switcher and the search change rows, not the page: keep the old rows
    // faded and unclickable until the new ones land - Jeel, 2026-09-28.
    keepPreviousData: true,
  });

  const actionFor = useCallback((lead: QueueLead) => rowAction(lead, me), [me]);

  /**
   * Look without picking. Opens the same workspace Pick opens - one page
   * however you arrive, Jeel 2026-09-28 - but assigns nothing, so its actions
   * stay switched off until you pick there. The workspace marks a reply read
   * only for the lead's holder, so looking does not do it either. What a row
   * click does, and what a superadmin's View button does.
   */
  const view = (lead: QueueLead) => navigate(`/leads/${lead.id}`);

  /**
   * Pick, then open the workspace. Only the button calls this - Jeel,
   * 2026-09-28: opening a lead to look at it must not assign it. A click on
   * the row used to do this too, so an agent glancing at a lead took it and
   * locked every colleague out without meaning to.
   */
  const open = async (lead: QueueLead) => {
    // Only a claim the server would allow: our own, or nobody's. A superadmin
    // looking at someone else's lead goes through view() instead.
    const allowed = actionFor(lead);
    if (allowed !== 'pick' && allowed !== 'resume') return;

    setClaiming(lead.id);
    setClaimError(null);
    try {
      await claimLead(lead.id);
      navigate(`/leads/${lead.id}`);
    } catch (err) {
      const failure = toApiError(err);
      if (failure.code === 'already_claimed') {
        // Someone was first in the seconds since this page last refreshed.
        // Their name is in the message; showing the queue again makes the row
        // mute itself.
        setClaimError(failure.message);
        await refresh();
      } else {
        setClaimError(failure.message);
      }
    } finally {
      setClaiming(null);
    }
  };

  const counts = data?.counts ?? {};
  const truncated = data ? data.total > data.leads.length : false;

  // Polls every 5s, so this normally reads "just now". When it does not, the
  // queue on screen is going stale - which is exactly when an agent should
  // notice.

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">Priority queue</h1>
          <p className="page-subtitle">Highest score first, then newest.</p>
        </div>
        <LiveStatus updatedAt={updatedAt} paused={Boolean(error)} />
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}
      {claimError && <Banner tone="error">{claimError}</Banner>}

      <div className="card table-card">
        <div className="table-card__toolbar">
          <Segmented
            label="Tier"
            value={tier}
            onChange={setTier}
            options={TIER_OPTIONS.map((option) => ({
              value: option.key,
              label: option.label,
              count: (option.key ? counts[option.key] : counts.all) ?? 0,
            }))}
          />

          <input
            className="search-input table-card__search"
            type="search"
            placeholder="Search name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search the queue"
          />
          <select
            className="select-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Source"
          >
            <option value="">All sources</option>
            {(data?.sources ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="select-input"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            aria-label="Time window"
          >
            {SINCE.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {data && <span className="table-card__count">{data.total} in queue</span>}
        </div>

        {loading ? (
          <div className="loading-block">
            <Spinner />
          </div>
        ) : !data || data.leads.length === 0 ? (
          <p className="table-card__empty">No leads in this view.</p>
        ) : (
          <div className={`table-wrap${switching ? ' is-switching' : ''}`}>
            <table className="table data-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Lead</th>
                  <th>Answers</th>
                  <th className="right">Score</th>
                  <th className="right">Waiting</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.leads.map((lead) => {
                  const action = actionFor(lead);
                  const locked = action === 'locked';

                  return (
                    <tr
                      key={lead.id}
                      className={`data-table__row${locked ? ' data-table__row--locked' : ''}`}
                      // A row click only ever looks. Picking is the button's job
                      // alone, so nothing is assigned by accident. Locked rows are
                      // not clickable at all - the lock has to be felt, not just
                      // seen.
                      onClick={locked ? undefined : () => view(lead)}
                      title={locked ? `${lead.tag?.agentName} is working this lead` : undefined}
                      aria-disabled={locked ? true : undefined}
                    >
                      <td>
                        <TierSignal tier={lead.tier} />
                      </td>
                      <td>
                        <span className="cell-name">{leadName(lead)}</span>
                        <span className="cell-sub">{formatPhone(lead.phone)}</span>
                      </td>
                      <td title={answersTitle(lead.answers)}>{answersText(lead.answers)}</td>
                      <td className="right tabular cell-strong">{lead.score}</td>
                      {/* One style for every waiting time - Jeel, 2026-09-28.
                          It used to turn bold for an overdue HOT lead, which
                          left the column half dark, half light. */}
                      <td className="right mono">
                        {formatAge(lead.receivedAt, now)}
                      </td>
                      <td className="mono cell-code">{lead.source ?? EMPTY}</td>
                      <td>{lead.tag ? <QueueStatus tag={lead.tag} /> : EMPTY}</td>
                      <td className="cell-action">
                        {locked ? (
                          <span className="queue__locked">
                            <LockIcon />
                            Locked
                          </span>
                        ) : (
                          <Button
                            variant="secondary"
                            disabled={claiming === lead.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (action === 'view') view(lead);
                              else void open(lead);
                            }}
                          >
                            {claiming === lead.id
                              ? // Resume sends the same claim as Pick up, but it
                                // is not taking anything - the lead is already
                                // yours and the server keeps its original pick
                                // time. The request only confirms nobody took
                                // it meanwhile.
                                action === 'resume'
                                ? 'Opening...'
                                : 'Picking up...'
                              : action === 'resume'
                                ? 'Resume'
                                : action === 'view'
                                  ? 'View'
                                  : 'Pick up'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {truncated && (
        <p className="queue__truncated">
          Showing the top {data!.leads.length} of {data!.total}. Narrow the filters to see the rest.
        </p>
      )}
    </section>
  );
}
