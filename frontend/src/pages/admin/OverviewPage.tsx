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
import { DISPOSITION_LABEL } from '../../api/workspace';
import { Banner } from '../../components/Banner';
import { LiveStatus } from '../../components/LiveStatus';
import { Segmented } from '../../components/Segmented';
import { Spinner } from '../../components/Spinner';
import { StatusIcon } from '../../components/StatusIcon';
import { formatRelative } from '../../lib/format';

/**
 * Admin > Overview: how the system and the agents are doing.
 *
 * DESIGN-PROMPT.md 6a; ADMIN.md. Phase 3 task 24.
 *
 * **Rebuilt in the admin card style - Jeel, 2026-09-28.** The funnel drew the
 * same numbers as the cards above it and is gone. Eight cards became four -
 * leads in, replied, answered all three, closed - because Calls made and
 * Reached are zero until Twilio (Phase 4) and HOT and DNC added are not what a
 * superadmin acts on. The agent table shows what they check each morning: who
 * is holding leads, who closed what, whose callbacks are due, and who has gone
 * quiet.
 *
 * **System status comes from the health endpoint, not from this route** -
 * ADMIN.md - so anything monitoring from outside reads exactly what this screen
 * does. It is fetched separately here for the same reason.
 */

const PERIODS: { value: OverviewPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

/** The health endpoint's check names, as a superadmin would say them. */
const CHECK_LABEL: Record<string, string> = {
  database: 'Database',
  poller: 'EZ Texting sync',
  webhook: 'Incoming replies',
  expiry: 'Expiry sweep',
  sending: 'Sending',
};

/** "karm closed Omar Haddad". */
function activityText(entry: Overview['activity'][number]): string {
  switch (entry.kind) {
    case 'disposition': {
      const value = String(entry.detail.value);
      if (value === 'closed') return 'closed';
      if (value === 'dnc') return 'marked DNC';
      // An outcome retired on 2026-09-28, still in older rows.
      return `set ${DISPOSITION_LABEL[value] ?? value} on`;
    }
    case 'note':
      return 'added a note on';
    case 'callback':
      return 'booked a callback with';
    case 'agent_sms':
      return 'texted';
    default:
      return 'worked on';
  }
}

function checkDetail(check: Health['checks'][number]): string | null {
  if (check.name === 'poller' && typeof check.detail.ageSeconds === 'number') {
    return `last poll ${formatRelative(new Date(Date.now() - check.detail.ageSeconds * 1000).toISOString())}`;
  }
  if (check.name === 'webhook') {
    return typeof check.detail.lastInboundAt === 'string'
      ? `last reply ${formatRelative(check.detail.lastInboundAt)}`
      : 'no replies yet';
  }
  return null;
}

export function OverviewPage() {
  const [period, setPeriod] = useState<OverviewPeriod>('today');

  const fetcher = useCallback(() => getOverview(period), [period]);
  const { data, loading, error, updatedAt } = usePolling<Overview>(fetcher);

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
  const stats = [
    { label: 'Leads in', value: kpis.leadsReceived, sub: null },
    { label: 'Replied', value: kpis.responded, sub: `${kpis.respondedPct}% of leads` },
    { label: 'Answered all 3', value: kpis.completed, sub: `${kpis.completedPct}% of leads` },
    { label: 'Closed', value: kpis.closed, sub: null },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">How the system and every agent are doing.</p>
        </div>
        <div className="page-header__status">
          <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
          <LiveStatus updatedAt={updatedAt} paused={Boolean(error)} />
        </div>
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}

      {/* Only when something is wrong: if the poller has stopped, every number
          below is stale, and that matters more than any of them. */}
      {health && health.status === 'degraded' && (
        <Banner tone="error">
          {health.checks
            .filter((c) => c.status === 'degraded')
            .map((c) => c.message ?? `${CHECK_LABEL[c.name] ?? c.name} is not working.`)
            .join(' ')}
        </Banner>
      )}

      <div className="card queue-card stats">
        {stats.map((stat) => (
          <div key={stat.label} className="stats__item">
            <span className="stats__label">{stat.label}</span>
            <span className="stats__value tabular">{stat.value}</span>
            <span className="stats__sub">{stat.sub ?? ' '}</span>
          </div>
        ))}
      </div>

      <div className="overview">
        <section className="card queue-card">
          <header className="card-head">
            <h2 className="card-head__title">Agents</h2>
            <span className="card-head__meta">Closed in this period</span>
          </header>
          <div className="table-wrap">
            <table className="table queue__table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="right">Working now</th>
                  <th className="right">Closed</th>
                  <th className="right">Callbacks due</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((agent) => (
                  <tr key={agent.agentId}>
                    <td>
                      <span className="queue__name">{agent.name}</span>
                    </td>
                    <td className="right tabular">{agent.holding || '-'}</td>
                    <td className="right tabular queue__score">{agent.closed || '-'}</td>
                    <td className="right tabular">{agent.callbacksPending || '-'}</td>
                    <td className="leads__when">
                      {agent.lastActiveAt ? formatRelative(agent.lastActiveAt) : 'No activity yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card queue-card">
          <header className="card-head">
            <h2 className="card-head__title">System</h2>
            {health && (
              <span className="card-head__meta">
                {health.status === 'ok' ? 'All working' : 'Needs attention'}
              </span>
            )}
          </header>
          {!health ? (
            <div className="leads__loading">
              <Spinner />
            </div>
          ) : (
            <dl className="kv">
              {health.checks.map((check) => {
                const detail = checkDetail(check);
                const ok = check.status === 'ok';
                return (
                  <div key={check.name} className="kv__row">
                    <dt>
                      {CHECK_LABEL[check.name] ?? check.name}
                      {detail && <span className="overview__detail">{detail}</span>}
                    </dt>
                    <dd>
                      <span className={`status${ok ? '' : ' status--warning'}`}>
                        <StatusIcon name={ok ? 'check' : 'warning'} />
                        {ok ? 'OK' : 'Degraded'}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </section>
      </div>

      <section className="card queue-card">
        <header className="card-head">
          <h2 className="card-head__title">Recent activity</h2>
          <span className="card-head__meta">Agent actions, newest first</span>
        </header>
        {data.activity.length === 0 ? (
          <p className="leads__empty">Nothing in this period.</p>
        ) : (
          <ul className="activity">
            {data.activity.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="activity__row">
                <span>
                  <strong>{entry.agentName ?? 'Someone'}</strong> {activityText(entry)}{' '}
                  <Link className="activity__lead" to={`/leads/${entry.leadId}/timeline`}>
                    {entry.leadName}
                  </Link>
                </span>
                <span className="activity__when">{formatRelative(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
