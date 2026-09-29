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
import { LiveStatus } from '../components/LiveStatus';
import { RowMenu } from '../components/RowMenu';
import { Segmented } from '../components/Segmented';
import { Spinner } from '../components/Spinner';
import { StatusIcon } from '../components/StatusIcon';
import { TierSignal } from '../components/TierSignal';
import { useAuth } from '../auth/store';
import { formatDateTime, formatPhone, formatTime, leadName, toLocalInput } from '../lib/format';

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
 *
 * **Rebuilt in the other pages' style - Jeel, 2026-09-28.** One card with the
 * navy switcher, the smooth switch, the phone under the name and the tier as
 * bars; Reschedule and Mark done behind the row's "⋯", Pick up beside it. A
 * superadmin's filter is a labelled **Agent** picker - Me, All agents, or one
 * agent - and the title says whose callbacks are shown. It was an unlabelled
 * dropdown reading "My callbacks" with no way to see everyone's.
 */

const TABS: { value: CallbackWhen; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'all', label: 'All' },
];

/** Whose callbacks: '' for your own, 'all' for everyone's, or an agent's id. */
type Whose = '' | 'all' | number;

export function CallbacksPage() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const isSuperadmin = me?.role === 'superadmin';

  const [when, setWhen] = useState<CallbackWhen>('today');
  const [whose, setWhose] = useState<Whose>('');
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
      .then((users) => setAgents(users.filter((u) => u.isActive && u.id !== me?.id)))
      .catch(() => {
        // The filter is a convenience; failing to load it should not stop the
        // page showing the callbacks the superadmin already has.
      });
  }, [isSuperadmin, me?.id]);

  const fetcher = useCallback(() => listCallbacks(when, whose === '' ? undefined : whose), [when, whose]);
  const {
    data,
    loading,
    error: pollError,
    refresh,
    updatedAt,
    switching,
  } = usePolling<CallbackList>(fetcher, {
    // As on every other page with the switcher: the old rows stay, faded and
    // unclickable, until the new ones land.
    keepPreviousData: true,
  });

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

  /** Picking up from here claims the lead, exactly as the queue does. */
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
  const everyone = whose === 'all';
  const other = typeof whose === 'number' ? agents.find((a) => a.id === whose) : undefined;

  const title = everyone ? 'All callbacks' : other ? `${other.name}'s callbacks` : 'My callbacks';
  const subtitle = everyone
    ? 'Calls every agent agreed to make.'
    : other
      ? `Calls ${other.name} agreed to make.`
      : 'Calls you agreed to make.';

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <LiveStatus updatedAt={updatedAt} paused={Boolean(pollError)} />
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {pollError && <Banner tone="warning">{pollError} Showing the last update.</Banner>}

      <div className="card table-card">
        <div className="table-card__toolbar">
          <Segmented
            label="When"
            value={when}
            onChange={setWhen}
            options={TABS.map((tab) => ({ ...tab, count: counts[tab.value] ?? 0 }))}
          />
          {isSuperadmin && (
            <label className="toolbar-field">
              <span className="toolbar-field__label">Agent</span>
              <select
                className="select-input"
                value={whose}
                onChange={(e) => {
                  const v = e.target.value;
                  setWhose(v === '' ? '' : v === 'all' ? 'all' : Number(v));
                }}
              >
                <option value="">Me</option>
                <option value="all">All agents</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data && (
            <span className="table-card__count toolbar-end">
              {data.callbacks.length} callback{data.callbacks.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="loading-block">
            <Spinner />
          </div>
        ) : !data || data.callbacks.length === 0 ? (
          <p className="table-card__empty">No callbacks in this view.</p>
        ) : (
          <div className={`table-wrap${switching ? ' is-switching' : ''}`}>
            <table className="table data-table">
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Lead</th>
                  <th>Tier</th>
                  {everyone && <th>Agent</th>}
                  <th>Last note</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.callbacks.map((row) => {
                  const late = overdueNow(row);
                  const scheduled = new Date(row.scheduledAt);

                  return (
                    <tr key={row.id}>
                      <td className="callbacks__due">
                        <span className="tabular">
                          {when === 'today' ? formatTime(scheduled) : formatDateTime(scheduled)}
                        </span>
                        {late && (
                          <span className="status status--warning callbacks__flag">
                            <StatusIcon name="clock" />
                            Overdue
                          </span>
                        )}
                        {row.doneAt && (
                          <span className="status status--muted callbacks__flag">
                            <StatusIcon name="check" />
                            Done
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="cell-name">{leadName(row.lead)}</span>
                        <span className="cell-sub">{formatPhone(row.lead.phone)}</span>
                      </td>
                      <td>
                        <TierSignal tier={row.lead.tier} />
                      </td>
                      {everyone && <td>{row.agentName || '-'}</td>}
                      <td className="callbacks__note">{row.latestNote ?? '-'}</td>
                      <td className="cell-action callbacks__actions">
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
                              onClick={() => void act(row.id, { scheduledAt: new Date(newTime).toISOString() })}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRescheduling(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="callbacks__reschedule">
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy === row.id}
                              onClick={() => void open(row)}
                            >
                              Pick up
                            </Button>
                            <RowMenu
                              label={`More for ${leadName(row.lead)}`}
                              items={[
                                {
                                  label: 'Reschedule',
                                  onSelect: () => {
                                    setRescheduling(row.id);
                                    setNewTime(toLocalInput(row.scheduledAt));
                                  },
                                },
                                ...(row.doneAt
                                  ? []
                                  : [{ label: 'Mark done', onSelect: () => void act(row.id, { done: true }) }]),
                              ]}
                            />
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
      </div>
    </section>
  );
}
