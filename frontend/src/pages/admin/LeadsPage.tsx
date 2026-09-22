import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../../api/client';
import { listAdminLeads, type AdminLead, type AdminLeadsResponse } from '../../api/leads';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { formatPhone, formatReceived, formatRelative } from './format';

const REFRESH_MS = 5000;

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_reply', label: 'Awaiting reply' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'opted_out', label: 'Opted out' },
  { key: 'expired', label: 'Expired' },
];

const SINCE: { key: string; label: string }[] = [
  { key: '1h', label: 'Last hour' },
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All time' },
];

const STATUS_LABEL: Record<string, string> = {
  awaiting_reply: 'Awaiting reply',
  in_progress: 'In progress',
  completed: 'Completed',
  needs_review: 'Needs review',
  opted_out: 'Opted out',
  expired: 'Expired',
};

const STATUS_TONE: Record<string, 'neutral' | 'navy' | 'success' | 'muted' | 'warning'> = {
  awaiting_reply: 'neutral',
  in_progress: 'navy',
  completed: 'success',
  needs_review: 'warning',
  opted_out: 'muted',
  expired: 'muted',
};

function leadName(lead: AdminLead): string {
  const first = lead.firstName?.trim();
  const last = lead.lastName?.trim();
  if (!first && !last) return 'Unknown';
  return [first, last ? `${last[0].toUpperCase()}.` : null].filter(Boolean).join(' ');
}

/** Warn when the poller looks stopped: the spec's threshold is three intervals. */
function pollIsStale(poll: AdminLeadsResponse['poll']): boolean {
  if (!poll.at) return false;
  return Date.now() - new Date(poll.at).getTime() > poll.intervalSeconds * 3000;
}

export function LeadsPage() {
  const [data, setData] = useState<AdminLeadsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [since, setSince] = useState('all');
  const [source, setSource] = useState<string>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  // Ids seen on the previous load, so genuinely new rows can be highlighted
  // rather than every row flashing on each refresh.
  const seen = useRef<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setData(null);
      try {
        const next = await listAdminLeads({
          status,
          since,
          source: source ? [source] : undefined,
          q: query || undefined,
          page,
        });

        const newIds = new Set(next.leads.filter((l) => !seen.current.has(l.id)).map((l) => l.id));
        // Everything is new on the first load; highlighting all of it is noise.
        if (seen.current.size > 0 && newIds.size > 0) {
          setFresh(newIds);
          setTimeout(() => setFresh(new Set()), 600);
        }
        next.leads.forEach((l) => seen.current.add(l.id));

        setData(next);
        setError(null);
      } catch (err) {
        setError(toApiError(err).message);
      }
    },
    [status, since, source, query, page]
  );

  // Filter changes reload with a spinner; the timer refreshes in place so the
  // table does not blank out every few seconds.
  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => void load(false), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const counts = data?.counts ?? {};
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">Leads</h1>
          <p className="page-subtitle">
            Every lead pulled from EZ Texting, including those who never replied.
          </p>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {data && pollIsStale(data.poll) && (
        <Banner tone="warning">
          No new leads pulled since {formatReceived(data.poll.at)} - check the worker.
        </Banner>
      )}

      <div className="leads__tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={status === tab.key}
            className={`leads__tab${status === tab.key ? ' leads__tab--active' : ''}`}
            onClick={() => {
              setStatus(tab.key);
              setPage(1);
            }}
          >
            {tab.label}
            <span className="leads__tab-count">{counts[tab.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="leads__filters">
        <input
          className="leads__search"
          type="search"
          placeholder="Search name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search leads"
        />
        <select
          className="leads__select"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPage(1);
          }}
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
          onChange={(e) => {
            setSince(e.target.value);
            setPage(1);
          }}
          aria-label="Received"
        >
          {SINCE.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {data && <span className="leads__total">{data.total} leads</span>}
      </div>

      {!data ? (
        <div className="leads__loading">
          <Spinner />
        </div>
      ) : data.leads.length === 0 ? (
        <p className="leads__empty">No leads in this view.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Lead</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Status</th>
                <th>Step</th>
                <th>Score</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.leads.map((lead) => (
                <tr
                  key={lead.id}
                  className={
                    (lead.status === 'opted_out' ? 'leads__row--danger ' : '') +
                    (fresh.has(lead.id) ? 'leads__row--new' : '')
                  }
                >
                  <td className="tabular">{formatReceived(lead.receivedAt)}</td>
                  <td>
                    <strong>{leadName(lead)}</strong>
                  </td>
                  <td className="tabular">{formatPhone(lead.phone)}</td>
                  <td className="mono">{lead.source ?? '-'}</td>
                  <td>
                    {lead.status ? (
                      <Badge tone={STATUS_TONE[lead.status]}>{STATUS_LABEL[lead.status]}</Badge>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{lead.stepReached ? `Q${lead.stepReached}` : '-'}</td>
                  <td>
                    {lead.score !== null ? (
                      <span className={`score${lead.tier ? ` score--${lead.tier.toLowerCase()}` : ''}`}>
                        <span className="score__value tabular">{lead.score}</span>
                        {lead.tier ? <span className="score__tier">{lead.tier}</span> : null}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    {lead.lastActivityAt ? (
                      <>
                        {lead.lastActivityDirection === 'inbound' ? '← ' : '→ '}
                        {formatRelative(lead.lastActivityAt)}
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="leads__pager">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
