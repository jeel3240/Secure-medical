import { useCallback, useEffect, useState } from 'react';
import { getDnc, type DncResult, type DncState } from '../../api/admin';
import { usePolling } from '../../api/usePolling';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { formatPhone, formatReceived } from '../../lib/format';

/**
 * Admin > DNC list. DESIGN-PROMPT.md 6e; ADMIN.md. Phase 3 task 25.
 *
 * **Read-only, with no manual add and no delete** - Jeel, 2026-09-23. A number
 * reaches this list through an agent's DNC disposition, an SMS STOP, or an EZ
 * Texting opt-out found by the poller; it leaves only by the lead texting
 * START. The design brief calls it a compliance record, so nothing here deletes
 * a row.
 *
 * **Released rows are shown as released, not hidden.** Hiding them would stop
 * the list matching who is actually blocked, and the dates are the record of
 * what happened.
 */

const TABS: { key: DncState; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'released', label: 'Released' },
];

/** Why a number was blocked, in words rather than the stored code. */
const REASON: Record<string, string> = {
  sms_stop: 'Texted STOP',
  ezt_opt_out: 'Opted out on EZ Texting',
  agent_disposition: 'Agent set DNC',
};

const RELEASE_REASON: Record<string, string> = {
  sms_start: 'Texted START',
};

export function DncPage() {
  const [state, setState] = useState<DncState>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const fetcher = useCallback(
    () => getDnc({ state, q: query || undefined, page }),
    [state, query, page]
  );
  const { data, loading, error } = usePolling<DncResult>(fetcher);

  const counts = data?.counts ?? { all: 0, blocked: 0, released: 0 };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">Do-not-call list</h1>
          <p className="page-subtitle">
            Every number ever blocked, and whether the block is still live.
          </p>
        </div>
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}

      <Banner tone="info">
        Numbers are added by a STOP reply, an EZ Texting opt-out, or an agent's DNC disposition, and
        released only when the lead texts START. Nothing is added or deleted from this screen.
      </Banner>

      <div className="leads__tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={state === tab.key}
            className={`leads__tab${state === tab.key ? ' leads__tab--active' : ''}`}
            onClick={() => {
              setState(tab.key);
              setPage(1);
            }}
          >
            {tab.label}
            <span className="leads__tab-count">{counts[tab.key]}</span>
          </button>
        ))}
      </div>

      <div className="leads__filters">
        <input
          className="leads__search"
          type="search"
          placeholder="Search number or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search the do-not-call list"
        />
        {data && <span className="leads__total">{data.total} numbers</span>}
      </div>

      {loading ? (
        <div className="leads__loading">
          <Spinner />
        </div>
      ) : !data || data.rows.length === 0 ? (
        <p className="leads__empty">No numbers in this view.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Lead</th>
                <th>Reason</th>
                <th>Added</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.phone} className={row.blocked ? undefined : 'dnc__row--released'}>
                  <td className="tabular">{formatPhone(row.phone)}</td>
                  <td>
                    {/* A number can be blocked before we hold a lead for it -
                        that is what protects a later partner delivery. */}
                    {row.lead ? row.lead.name : <span className="summary__gap">No lead</span>}
                  </td>
                  <td>{REASON[row.reason] ?? row.reason}</td>
                  <td>{formatReceived(row.addedAt)}</td>
                  <td>
                    {row.blocked ? (
                      <Badge tone="muted">Blocked</Badge>
                    ) : (
                      <>
                        <Badge tone="success">Released</Badge>
                        <span className="dnc__released">
                          {RELEASE_REASON[row.releasedReason ?? ''] ?? row.releasedReason}
                          {row.releasedAt && ` · ${formatReceived(row.releasedAt)}`}
                        </span>
                      </>
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
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
