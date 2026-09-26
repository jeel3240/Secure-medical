import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toApiError } from '../api/client';
import { claimLead } from '../api/leads';
import { usePolling } from '../api/usePolling';
import { listUsers } from '../api/users';
import type { PublicUser } from '../api/types';
import {
  listCallbacks,
  updateCallback,
  type CallbackList,
  type CallbackRow,
  type CallbackWhen,
} from '../api/workspace';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { useAuth } from '../auth/store';
import { formatPhone, leadName } from '../lib/format';

/**
 * The agent's scheduled callbacks. DESIGN-PROMPT.md 5. Phase 3 task 22.
 *
 * The three tabs are windows on `scheduled_at` where the callback is not done -
 * `AGENT-WORKSPACE.md`, "Callbacks". Today means the rest of today, not the
 * whole day: a callback booked for 9am and still open at 3pm is overdue, not
 * both, or an agent could clear the Today tab while the call they missed sits
 * unmade.
 *
 * Counts for every tab come back whichever tab is open, so the overdue badge is
 * always right.
 */

const TABS: { key: CallbackWhen; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'all', label: 'All' },
];

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** `<input type="datetime-local">` wants local time with no zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

export function CallbacksPage() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const isSuperadmin = me?.role === 'superadmin';

  const [when, setWhen] = useState<CallbackWhen>('today');
  const [agentId, setAgentId] = useState<number | ''>('');
  const [agents, setAgents] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [rescheduling, setRescheduling] = useState<number | null>(null);
  const [newTime, setNewTime] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Only a superadmin can read another agent's callbacks, so only they need
  // the list of who to pick from.
  useEffect(() => {
    if (!isSuperadmin) return;
    void listUsers()
      .then((users) => setAgents(users.filter((u) => u.isActive)))
      .catch(() => {
        // The filter is a convenience; failing to load it should not stop the
        // page showing the callbacks the superadmin already has.
      });
  }, [isSuperadmin]);

  const fetcher = useCallback(
    () => listCallbacks(when, agentId === '' ? undefined : agentId),
    [when, agentId]
  );
  const { data, loading, error: pollError, refresh } = usePolling<CallbackList>(fetcher);

  const act = async (id: number, changes: { done?: boolean; scheduledAt?: string }) => {
    setBusy(id);
    setError(null);
    try {
      await updateCallback(id, changes);
      setRescheduling(null);
      await refresh();
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  /** Opening from here claims the lead, exactly as the queue does. */
  const open = async (row: CallbackRow) => {
    setBusy(row.id);
    setError(null);
    try {
      await claimLead(row.leadId);
      navigate(`/leads/${row.leadId}`);
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(null);
    }
  };

  const counts = data?.counts ?? {};
  const overdueNow = (row: CallbackRow) => !row.doneAt && new Date(row.scheduledAt) < new Date();

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">My callbacks</h1>
          <p className="page-subtitle">Calls you agreed to make.</p>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {pollError && <Banner tone="warning">{pollError} Showing the last update.</Banner>}

      <div className="leads__tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={when === tab.key}
            className={`leads__tab${when === tab.key ? ' leads__tab--active' : ''}`}
            onClick={() => setWhen(tab.key)}
          >
            {tab.label}
            <span
              className={`leads__tab-count${
                tab.key === 'overdue' && (counts.overdue ?? 0) > 0 ? ' leads__tab-count--alert' : ''
              }`}
            >
              {counts[tab.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {isSuperadmin && (
        <div className="leads__filters">
          <select
            className="leads__select"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value === '' ? '' : Number(e.target.value))}
            aria-label="Agent"
          >
            <option value="">My callbacks</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="leads__loading">
          <Spinner />
        </div>
      ) : !data || data.callbacks.length === 0 ? (
        <p className="leads__empty">Nothing in this view.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Lead</th>
                <th>Phone</th>
                <th>Note</th>
                <th>Source</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.callbacks.map((row) => {
                const late = overdueNow(row);
                const scheduled = new Date(row.scheduledAt);

                return (
                  <tr key={row.id} className={late ? 'callbacks__row--overdue' : undefined}>
                    <td className="tabular">
                      {when === 'today' ? timeFormat.format(scheduled) : dayTimeFormat.format(scheduled)}
                      {late && <span className="callbacks__late">Overdue</span>}
                    </td>
                    <td>
                      <strong>{leadName(row.lead)}</strong>
                      {row.lead.tier && (
                        <span className={`tier tier--${row.lead.tier.toLowerCase()}`}>
                          {row.lead.tier}
                        </span>
                      )}
                    </td>
                    <td className="tabular">{formatPhone(row.lead.phone)}</td>
                    <td className="callbacks__note">{row.latestNote ?? '-'}</td>
                    <td className="mono">{row.lead.source ?? '-'}</td>
                    <td className="right">
                      {rescheduling === row.id ? (
                        <div className="callbacks__reschedule">
                          <input
                            type="datetime-local"
                            className="actions-panel__input"
                            value={newTime}
                            onChange={(e) => setNewTime(e.target.value)}
                            aria-label="New time"
                          />
                          <Button
                            size="sm"
                            disabled={!newTime || busy === row.id}
                            onClick={() =>
                              void act(row.id, { scheduledAt: new Date(newTime).toISOString() })
                            }
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRescheduling(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="callbacks__actions">
                          <Button size="sm" variant="secondary" onClick={() => void open(row)}>
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setRescheduling(row.id);
                              setNewTime(toLocalInput(row.scheduledAt));
                            }}
                          >
                            Reschedule
                          </Button>
                          {!row.doneAt && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy === row.id}
                              onClick={() => void act(row.id, { done: true })}
                            >
                              Mark done
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
