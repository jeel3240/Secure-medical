import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getHealth,
  getOverview,
  type Health,
  type Overview,
  type OverviewPeriod,
} from '../../api/admin';
import { usePolling } from '../../api/usePolling';
import { DISPOSITION_LABEL, type Disposition } from '../../api/workspace';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Spinner } from '../../components/Spinner';
import { formatRelative } from '../../lib/format';

/**
 * Admin > Overview: how the system and the agents are doing.
 *
 * DESIGN-PROMPT.md 6a; ADMIN.md. Phase 3 task 24.
 *
 * **System status comes from the health endpoint, not from this route** -
 * ADMIN.md - so anything monitoring from outside reads exactly what this screen
 * does. It is fetched separately here for the same reason.
 *
 * **Every call figure is zero until Twilio lands in Phase 4.** The API says so
 * with `callsBuilt: false`, and the page repeats it rather than showing a row
 * of zeros that reads like nobody is calling.
 */

const PERIODS: { key: OverviewPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
];

const STAGE_LABEL: Record<string, string> = {
  received: 'Received',
  responded: 'Responded',
  completed: 'Completed',
  called: 'Called',
  interested: 'Interested',
};

function activityText(entry: Overview['activity'][number]): string {
  switch (entry.kind) {
    case 'disposition': {
      const value = entry.detail.value as Disposition;
      return `set ${DISPOSITION_LABEL[value] ?? value} on`;
    }
    case 'note':
      return 'noted on';
    case 'callback':
      return 'scheduled a callback for';
    case 'agent_sms':
      return 'texted';
    default:
      return 'acted on';
  }
}

/** `2m 14s` - how an average call length reads. */
function callLength(seconds: number | null): string {
  if (seconds === null) return '-';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function OverviewPage() {
  const [period, setPeriod] = useState<OverviewPeriod>('today');

  const fetcher = useCallback(() => getOverview(period), [period]);
  const { data, loading, error } = usePolling<Overview>(fetcher);

  const healthFetcher = useCallback(() => getHealth(), []);
  const { data: health } = usePolling<Health>(healthFetcher);

  if (loading) {
    return (
      <div className="leads__loading">
        <Spinner />
      </div>
    );
  }

  if (!data) return <Banner tone="error">{error ?? 'The overview could not be loaded.'}</Banner>;

  const { kpis } = data;
  const biggestStage = Math.max(1, ...data.funnel.map((f) => f.count));

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">Everything across every agent.</p>
        </div>
        <div className="leads__filters">
          <select
            className="leads__select"
            value={period}
            onChange={(e) => setPeriod(e.target.value as OverviewPeriod)}
            aria-label="Period"
          >
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}

      {/* Health first: if the poller has stopped, every number below is stale
          and that matters more than any of them. */}
      {health && health.status === 'degraded' && (
        <Banner tone="error">
          {health.checks
            .filter((c) => c.status === 'degraded')
            .map((c) => c.message ?? `${c.name} is degraded.`)
            .join(' ')}
        </Banner>
      )}

      <div className="kpis">
        <Kpi label="Leads received" value={kpis.leadsReceived} />
        <Kpi label="Responded" value={kpis.responded} sub={`${kpis.respondedPct}%`} />
        <Kpi label="Completed" value={kpis.completed} sub={`${kpis.completedPct}%`} />
        <Kpi label="HOT" value={kpis.hot} />
        <Kpi label="Calls made" value={kpis.callsMade} muted={!data.callsBuilt} />
        <Kpi label="Reached" value={kpis.reached} sub={`${kpis.reachedPct}%`} muted={!data.callsBuilt} />
        <Kpi label="Callbacks set" value={kpis.callbacksSet} />
        <Kpi label="DNC added" value={kpis.dncAdded} />
      </div>

      {!data.callsBuilt && (
        <p className="overview__note">
          Call figures stay at zero until browser calling is switched on in Phase 4 - nothing
          records calls yet.
        </p>
      )}

      <div className="overview__grid">
        <section className="card overview__card">
          <h2 className="config__title">Funnel</h2>
          <ul className="funnel">
            {data.funnel.map((stage) => (
              <li key={stage.stage} className="funnel__row">
                <span className="funnel__label">{STAGE_LABEL[stage.stage] ?? stage.stage}</span>
                <span className="funnel__bar-wrap">
                  <span
                    className="funnel__bar"
                    style={{ width: `${(stage.count / biggestStage) * 100}%` }}
                  />
                </span>
                <span className="funnel__count tabular">{stage.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card overview__card">
          <h2 className="config__title">System</h2>
          {!health ? (
            <Spinner />
          ) : (
            <dl className="summary">
              {health.checks.map((check) => (
                <div key={check.name} className="overview__check">
                  <dt>{check.name}</dt>
                  <dd>
                    {check.status === 'ok' ? (
                      <Badge tone="success">ok</Badge>
                    ) : (
                      <Badge tone="warning">degraded</Badge>
                    )}
                    {check.name === 'poller' && typeof check.detail.ageSeconds === 'number' && (
                      <span className="overview__check-detail">
                        last poll {check.detail.ageSeconds}s ago
                      </span>
                    )}
                    {check.name === 'webhook' && (
                      <span className="overview__check-detail">
                        {typeof check.detail.lastInboundAt === 'string'
                          ? `last reply ${formatRelative(check.detail.lastInboundAt)}`
                          : 'no replies yet'}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      <section className="card overview__card">
        <h2 className="config__title">Agents</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="right">Calls</th>
                <th className="right">Reached</th>
                <th className="right">Avg call</th>
                <th>Dispositions</th>
                <th className="right">Callbacks pending</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((agent) => (
                <tr key={agent.agentId}>
                  <td>
                    <strong>{agent.name}</strong>
                  </td>
                  <td className="right tabular">{agent.calls}</td>
                  <td className="right tabular">{agent.reached}</td>
                  <td className="right tabular">{callLength(agent.avgCallSeconds)}</td>
                  <td>
                    {Object.keys(agent.dispositions).length === 0
                      ? '-'
                      : Object.entries(agent.dispositions)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([value, n]) => (
                            <span key={value} className="config__choice">
                              {DISPOSITION_LABEL[value as Disposition] ?? value}{' '}
                              <strong className="tabular">{n}</strong>
                            </span>
                          ))}
                  </td>
                  <td className="right tabular">{agent.callbacksPending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overview__card">
        <h2 className="config__title">Recent activity</h2>
        {data.activity.length === 0 ? (
          <p className="summary__empty">Nothing in this period.</p>
        ) : (
          <ul className="summary__list">
            {data.activity.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <span className="summary__list-when">{formatRelative(entry.at)}</span>
                <span>
                  <strong>{entry.agentName ?? 'Someone'}</strong> {activityText(entry)}{' '}
                  <Link to={`/leads/${entry.leadId}/timeline`}>{entry.leadName}</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  muted,
}: {
  label: string;
  value: number;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div className={`kpi${muted ? ' kpi--muted' : ''}`}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value tabular">{value}</span>
      {sub && <span className="kpi__sub tabular">{sub}</span>}
    </div>
  );
}
