import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDnc, type DncResult, type DncState } from '../../api/admin';
import { usePolling } from '../../api/usePolling';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { LiveStatus } from '../../components/LiveStatus';
import { Segmented } from '../../components/Segmented';
import { Spinner } from '../../components/Spinner';
import { StatusIcon } from '../../components/StatusIcon';
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
 *
 * **Built like Admin > Leads - Jeel, 2026-09-28**, for consistency: one card
 * with the queue's navy switcher, the same table, the phone under the name, the
 * state as an icon and words, and "Live · updated" in the header. The blue
 * explainer box became a quiet note at the foot of the card. A row with a lead
 * opens that lead's timeline.
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
  const navigate = useNavigate();
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
  const { data, loading, error, updatedAt } = usePolling<DncResult>(fetcher);

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
        <LiveStatus updatedAt={updatedAt} paused={Boolean(error)} />
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}

      <div className="card queue-card">
        <div className="queue-card__toolbar">
          <Segmented
            label="State"
            value={state}
            onChange={(next) => {
              setState(next);
              setPage(1);
            }}
            options={TABS.map((tab) => ({ value: tab.key, label: tab.label, count: counts[tab.key] }))}
          />
          <input
            className="leads__search queue-card__search"
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
            <table className="table queue__table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Reason</th>
                  <th>Added</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const lead = row.lead;
                  return (
                    <tr
                      key={row.phone}
                      className={lead ? 'queue__row' : undefined}
                      onClick={lead ? () => navigate(`/leads/${lead.id}/timeline`) : undefined}
                      title={lead ? 'Open the timeline' : undefined}
                    >
                      <td>
                        {/* A number can be blocked before we hold a lead for it -
                            that is what protects a later partner delivery. */}
                        <span className={`queue__name${lead ? '' : ' dnc__no-lead'}`}>
                          {lead ? lead.name : 'No lead'}
                        </span>
                        <span className="queue__phone">{formatPhone(row.phone)}</span>
                      </td>
                      <td>{REASON[row.reason] ?? row.reason}</td>
                      <td className="leads__when">{formatReceived(row.addedAt)}</td>
                      <td>
                        {row.blocked ? (
                          <span className="status status--danger">
                            <StatusIcon name="ban" />
                            Blocked
                          </span>
                        ) : (
                          <>
                            <span className="status status--muted">
                              <StatusIcon name="check" />
                              Released
                            </span>
                            <span className="dnc__released">
                              {RELEASE_REASON[row.releasedReason ?? ''] ?? row.releasedReason}
                              {row.releasedAt && ` · ${formatReceived(row.releasedAt)}`}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
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

        <p className="card-note">
          Numbers are added by a STOP reply, an EZ Texting opt-out, or an agent's DNC, and released
          only when the lead texts START. Nothing is added or removed here.
        </p>
      </div>
    </section>
  );
}
