import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toApiError } from '../api/client';
import { claimLead, listQueue, type QueueLead, type QueueResponse } from '../api/leads';
import { usePolling } from '../api/usePolling';
import { useAuth } from '../auth/store';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { QueueTagBadge } from '../components/QueueTagBadge';
import { Spinner } from '../components/Spinner';
import { ageTone, answerLabel, formatAge, formatPhone, leadName } from '../lib/format';
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
 * **No paging.** The endpoint truncates at 100 and says so; at 50-100 leads a
 * day that holds several days of queue. `total` drives the note when it bites.
 */

const TIERS = ['HOT', 'WARM', 'LOW'] as const;

const SINCE: { key: string; label: string }[] = [
  { key: '1h', label: 'Last hour' },
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'all', label: 'All time' },
];

/** Ticks once a second so the age column counts up between polls. */
function useSecond(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function QueuePage() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const now = useSecond();

  const [tiers, setTiers] = useState<string[]>([]);
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
        tier: tiers.length ? tiers : undefined,
        source: source ? [source] : undefined,
        since,
        q: query || undefined,
      }),
    [tiers, source, since, query]
  );

  const { data, loading, error, refresh, updatedAt } = usePolling<QueueResponse>(fetcher);

  const toggleTier = (tier: string) =>
    setTiers((current) =>
      current.includes(tier) ? current.filter((t) => t !== tier) : [...current, tier]
    );

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

  const liveLabel = useMemo(() => {
    if (!updatedAt) return 'Connecting';
    const seconds = Math.round((now.getTime() - updatedAt) / 1000);
    return seconds < 10 ? 'Live' : `Updated ${seconds}s ago`;
  }, [updatedAt, now]);

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">Priority queue</h1>
          <p className="page-subtitle">Highest score first, then longest waiting.</p>
        </div>
        <span className={`live${error ? ' live--paused' : ''}`}>
          <span className="live__dot" aria-hidden="true" />
          {error ? 'Live updates paused' : liveLabel}
        </span>
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}
      {claimError && <Banner tone="error">{claimError}</Banner>}

      <div className="queue__pills">
        {TIERS.map((tier) => (
          <button
            key={tier}
            className={`pill pill--${tier.toLowerCase()}${tiers.includes(tier) ? ' pill--on' : ''}`}
            aria-pressed={tiers.includes(tier)}
            onClick={() => toggleTier(tier)}
          >
            {tier}
            <span className="pill__count tabular">{counts[tier] ?? 0}</span>
          </button>
        ))}
        {tiers.length > 0 && (
          <button className="queue__clear" onClick={() => setTiers([])}>
            Clear
          </button>
        )}
      </div>

      <div className="leads__filters">
        <input
          className="leads__search"
          type="search"
          placeholder="Search name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search the queue"
        />
        <select
          className="leads__select"
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
          className="leads__select"
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
        {data && <span className="leads__total">{counts.all ?? data.total} in queue</span>}
      </div>

      {loading ? (
        <div className="leads__loading">
          <Spinner />
        </div>
      ) : !data || data.leads.length === 0 ? (
        <p className="leads__empty">No leads in this view.</p>
      ) : (
        <div className="table-wrap">
          <table className="table queue__table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Lead</th>
                <th>Interest</th>
                <th>Timing</th>
                <th>Preference</th>
                <th className="right">Score</th>
                <th className="right">Age</th>
                <th>Source</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.leads.map((lead) => {
                const action = actionFor(lead);
                const locked = action === 'locked';
                const tone = ageTone(lead.receivedAt, lead.tier, now);

                return (
                  <tr
                    key={lead.id}
                    className={`queue__row${locked ? ' queue__row--locked' : ''}`}
                    // A row click only ever looks. Picking is the button's job
                    // alone, so nothing is assigned by accident. Locked rows are
                    // not clickable at all - the lock has to be felt, not just
                    // seen.
                    onClick={locked ? undefined : () => view(lead)}
                    title={locked ? `${lead.tag.agentName} is working this lead` : undefined}
                    aria-disabled={locked ? true : undefined}
                  >
                    <td>
                      {lead.tier ? (
                        <span className={`tier tier--${lead.tier.toLowerCase()}`}>{lead.tier}</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <strong>{leadName(lead)}</strong>
                      <span className="queue__phone tabular">{formatPhone(lead.phone)}</span>
                    </td>
                    <td>{answerLabel(1, lead.q1)}</td>
                    <td>{answerLabel(2, lead.q2)}</td>
                    <td>{answerLabel(3, lead.q3)}</td>
                    <td className="right tabular">
                      <strong>{lead.score}</strong>
                    </td>
                    <td className={`right tabular age age--${tone}`}>
                      {formatAge(lead.receivedAt, now)}
                    </td>
                    <td className="mono">{lead.source ?? '-'}</td>
                    <td>
                      <QueueTagBadge tag={lead.tag} />
                    </td>
                    <td className="right">
                      {locked ? (
                        <Badge tone="muted">Locked</Badge>
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
                            ? // Resume sends the same claim as Pick, but it is not
                              // picking anything - the lead is already yours and
                              // the server keeps its original pick time. The
                              // request only confirms nobody took it meanwhile.
                              action === 'resume'
                              ? 'Opening...'
                              : 'Picking...'
                            : action === 'resume'
                              ? 'Resume'
                              : action === 'view'
                                ? 'View'
                                : 'Pick'}
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

      {truncated && (
        <p className="queue__truncated">
          Showing the top {data!.leads.length} of {data!.total}. Narrow the filters to see the rest.
        </p>
      )}
    </section>
  );
}
