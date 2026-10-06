import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAdminLeads, type AdminLeadsResponse } from '../../api/leads';
import { usePolling } from '../../api/usePolling';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { LeadStatus } from '../../components/LeadStatus';
import { LiveStatus } from '../../components/LiveStatus';
import { Segmented } from '../../components/Segmented';
import { Spinner } from '../../components/Spinner';
import { SyncStatus } from '../../components/SyncStatus';
import { TierSignal } from '../../components/TierSignal';
import { formatPhone, formatReceived, formatRelative, leadName } from '../../lib/format';

/**
 * Admin > Leads: every lead the poller has pulled in, replied or not.
 * `ADMIN-LEADS.md` is the page's doc.
 *
 * **Redesigned to match the queue - Jeel, 2026-09-28.** One card holding the
 * status tabs, the filters and the table, under a grey header band; the tier
 * as signal bars, the score a plain number, each status an icon and words; the
 * phone under the name. The pieces are the queue's own - `TierSignal`,
 * `StatusIcon`, `LiveStatus` - so the two screens cannot drift apart.
 *
 * A row opens the lead's timeline, read-only - the brief always asked for it,
 * and it waited on that page existing.
 */

/** A hyphen for an empty cell, as on the queue. */
const EMPTY = '-';

/**
 * In the order a lead lives them - Awaiting reply, Answering, Ready,
 * Working, Closed - then the three other ways the SMS part can end. Working
 * and Closed were added, and In progress and Completed renamed, by Jeel on
 * 2026-09-28: ADMIN-LEADS.md, "Status".
 */
const TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_reply', label: 'Awaiting reply' },
  { key: 'answering', label: 'Answering' },
  { key: 'ready', label: 'Ready' },
  { key: 'offers', label: 'Offers' },
  { key: 'declined', label: 'Not interested' },
  { key: 'working', label: 'Working' },
  { key: 'closed', label: 'Closed' },
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

export function LeadsPage() {
  const navigate = useNavigate();
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

  // Polling lives in one place now - api/usePolling.ts, Phase 3 task 14. This
  // screen had its own 5s interval before that, and copying it to every live
  // screen is how several different refresh behaviours get shipped.
  const fetcher = useCallback(
    () =>
      listAdminLeads({
        status,
        since,
        source: source ? [source] : undefined,
        q: query || undefined,
        page,
      }),
    [status, since, source, query, page]
  );

  const { data, error, updatedAt, switching } = usePolling<AdminLeadsResponse>(fetcher, {
    // The switcher and the search change rows, not the page: keep the old rows
    // faded and unclickable until the new ones land - Jeel, 2026-09-28.
    keepPreviousData: true,
  });

  // Highlight rows that were not in the previous response. Driven off `data`
  // rather than the fetch, so it works the same whichever tick delivered them.
  useEffect(() => {
    if (!data) return;
    const newIds = new Set(data.leads.filter((l) => !seen.current.has(l.id)).map((l) => l.id));
    // Everything is new on the first load; highlighting all of it is noise.
    if (seen.current.size > 0 && newIds.size > 0) {
      setFresh(newIds);
      setTimeout(() => setFresh(new Set()), 600);
    }
    data.leads.forEach((l) => seen.current.add(l.id));
  }, [data]);

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
        <div className="page-header__status">
          <LiveStatus updatedAt={updatedAt} paused={Boolean(error)} />
          {data && <SyncStatus at={data.poll.at} intervalSeconds={data.poll.intervalSeconds} />}
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="card table-card">
        {/* The queue's tier switcher, so the chosen status is the brand navy
            and slides the same way - Jeel, 2026-09-28. The underline tabs it
            replaces used the brighter link blue. Ten options: dense, and on
            a screen too narrow for them the row scrolls - it never wraps. */}
        <div className="table-card__toolbar table-card__toolbar--scroll">
          <Segmented
            label="Status"
            dense
            value={status}
            onChange={(next) => {
              setStatus(next);
              setPage(1);
            }}
            options={TABS.map((tab) => ({ value: tab.key, label: tab.label, count: counts[tab.key] ?? 0 }))}
          />
        </div>

        <div className="table-card__toolbar">
          <input
            className="search-input table-card__search"
            type="search"
            placeholder="Search name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search leads"
          />
          <select
            className="select-input"
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
            className="select-input"
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
          {data && <span className="table-card__count">{data.total} leads</span>}
        </div>

        {!data ? (
          <div className="loading-block">
            <Spinner />
          </div>
        ) : data.leads.length === 0 ? (
          <p className="table-card__empty">No leads in this view.</p>
        ) : (
          <div className={`table-wrap${switching ? ' is-switching' : ''}`}>
            <table className="table data-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Lead</th>
                  <th>Status</th>
                  <th>Step</th>
                  <th className="right">Score</th>
                  <th>Source</th>
                  <th>Received</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className={`data-table__row${fresh.has(lead.id) ? ' data-table__row--new' : ''}`}
                    onClick={() => navigate(`/leads/${lead.id}/timeline`)}
                    title="Open the timeline"
                  >
                    <td>
                      <TierSignal tier={lead.tier} />
                    </td>
                    <td>
                      <span className="cell-name">{leadName(lead)}</span>
                      <span className="cell-sub">{formatPhone(lead.phone)}</span>
                    </td>
                    <td>{lead.status ? <LeadStatus status={lead.status} /> : EMPTY}</td>
                    {/* "Q2" and "Q1-a" in the code face, as before; "Done", and a
                        question that goes by its heading, are words. */}
                    <td className={lead.step && /^Q\d/.test(lead.step) ? 'mono' : undefined}>
                      {lead.step === 'done' ? 'Done' : (lead.step ?? EMPTY)}
                    </td>
                    <td className="right tabular cell-strong">{lead.score ?? EMPTY}</td>
                    <td className="mono cell-code">{lead.source ?? EMPTY}</td>
                    <td className="cell-muted">{formatReceived(lead.receivedAt)}</td>
                    <td className="cell-muted">
                      {lead.lastActivityAt ? (
                        <>
                          <span aria-label={lead.lastActivityDirection === 'inbound' ? 'From the lead' : 'To the lead'}>
                            {lead.lastActivityDirection === 'inbound' ? '← ' : '→ '}
                          </span>
                          {formatRelative(lead.lastActivityAt)}
                        </>
                      ) : (
                        EMPTY
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && totalPages > 1 && (
          <div className="table-card__pager">
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
      </div>
    </section>
  );
}
