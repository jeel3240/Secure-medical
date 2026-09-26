/**
 * Admin > Overview: KPI cards, the funnel, the per-agent table and the recent
 * activity feed. ADMIN.md, "Overview"; DESIGN-PROMPT.md 6a.
 *
 * Everything is derived on the read. Nothing here is stored as a running total:
 * at 50-100 leads a day the queries are cheap, and a stale counter is worse
 * than a slow one.
 *
 * **Live system status is not here.** Last poll, last webhook and worker health
 * come from the health endpoint - `LOGGING.md` - so that anything monitoring
 * the system from outside reads exactly what this screen does.
 *
 * **Call figures are all zero until Phase 4.** `calls` is never written to yet;
 * the columns are counted the same way they will be once Twilio lands, so the
 * screen does not change shape later. `callsBuilt: false` says so, rather than
 * leaving a superadmin to wonder whether nobody is calling or nothing is
 * recording.
 */

import { pool } from './pool';

export type OverviewPeriod = 'today' | '7d' | '30d';

/** Start of the window. `today` is midnight, not the last 24 hours. */
const SINCE_SQL: Record<OverviewPeriod, string> = {
  today: `date_trunc('day', now())`,
  '7d': `now() - interval '7 days'`,
  '30d': `now() - interval '30 days'`,
};

export interface AgentRow {
  agentId: number;
  name: string;
  calls: number;
  reached: number;
  avgCallSeconds: number | null;
  dispositions: Record<string, number>;
  callbacksPending: number;
}

export interface ActivityEntry {
  kind: 'disposition' | 'note' | 'callback' | 'agent_sms';
  at: string;
  agentName: string | null;
  leadId: number;
  leadName: string;
  detail: Record<string, unknown>;
}

export interface Overview {
  period: OverviewPeriod;
  since: string;
  kpis: {
    leadsReceived: number;
    responded: number;
    respondedPct: number;
    completed: number;
    completedPct: number;
    hot: number;
    callsMade: number;
    reached: number;
    reachedPct: number;
    callbacksSet: number;
    dncAdded: number;
  };
  funnel: { stage: string; count: number }[];
  agents: AgentRow[];
  activity: ActivityEntry[];
  /** False until Twilio lands: every call figure above is structurally zero. */
  callsBuilt: boolean;
}

/** Percentage of a base, rounded, and 0 rather than NaN when the base is 0. */
const pct = (n: number, base: number): number => (base > 0 ? Math.round((n / base) * 100) : 0);

export async function getOverview(period: OverviewPeriod): Promise<Overview> {
  const since = SINCE_SQL[period];

  // Leads are counted by when they reached us - ezt_added_at where EZ Texting
  // gave us one, created_at otherwise - the same expression the queue uses for
  // a lead's age.
  const received = `COALESCE(l.ezt_added_at, l.created_at)`;

  const [leadRows, callRows, callbackRows, dncRows, agentRows, activityRows] = await Promise.all([
    pool.query(`
      SELECT
        count(*)::int AS leads_received,
        count(*) FILTER (WHERE c.score > 0)::int AS responded,
        count(*) FILTER (WHERE c.status = 'completed')::int AS completed,
        count(*) FILTER (WHERE c.tier = 'HOT')::int AS hot
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT status, score, tier FROM conversations
        WHERE lead_id = l.id ORDER BY created_at DESC, id DESC LIMIT 1
      ) c ON true
      WHERE ${received} >= ${since}
    `),

    // Counted by when the call started, not when its lead arrived: a call made
    // today about a lead from last week belongs in today's figures.
    pool.query(`
      SELECT
        count(*)::int AS calls_made,
        count(*) FILTER (WHERE duration_sec > 0)::int AS reached
      FROM calls WHERE started_at >= ${since}
    `),

    pool.query(`SELECT count(*)::int AS n FROM callbacks WHERE created_at >= ${since}`),

    // Blocks added in the window, whether or not they have since been released:
    // the KPI is "DNC added", an event, not a current total.
    pool.query(`SELECT count(*)::int AS n FROM dnc_list WHERE added_at >= ${since}`),

    pool.query(`
      SELECT
        u.id AS agent_id,
        u.name,
        count(DISTINCT ca.id)::int AS calls,
        count(DISTINCT ca.id) FILTER (WHERE ca.duration_sec > 0)::int AS reached,
        avg(ca.duration_sec) FILTER (WHERE ca.duration_sec > 0) AS avg_call_seconds,
        COALESCE(
          (SELECT jsonb_object_agg(value, n) FROM (
            SELECT d.value, count(*)::int AS n
            FROM dispositions d
            WHERE d.agent_id = u.id AND d.created_at >= ${since}
            GROUP BY d.value
          ) x),
          '{}'::jsonb
        ) AS dispositions,
        (
          SELECT count(*)::int FROM callbacks cb
          WHERE cb.agent_id = u.id AND cb.done_at IS NULL
        ) AS callbacks_pending
      FROM users u
      LEFT JOIN calls ca ON ca.agent_id = u.id AND ca.started_at >= ${since}
      WHERE u.is_active
      GROUP BY u.id, u.name
      ORDER BY u.name
    `),

    // One feed from four tables. Agent actions only: the automated flow is
    // already visible per lead on the timeline, and this answers "what are my
    // agents doing".
    pool.query(`
      SELECT * FROM (
        SELECT 'disposition' AS kind, d.created_at AS at, u.name AS agent_name,
               l.id AS lead_id, l.first_name, l.last_name,
               jsonb_build_object('value', d.value) AS detail
        FROM dispositions d
        JOIN leads l ON l.id = d.lead_id
        LEFT JOIN users u ON u.id = d.agent_id
        WHERE d.created_at >= ${since}

        UNION ALL
        SELECT 'note', n.created_at, u.name, l.id, l.first_name, l.last_name,
               jsonb_build_object('body', n.body)
        FROM notes n
        JOIN leads l ON l.id = n.lead_id
        LEFT JOIN users u ON u.id = n.agent_id
        WHERE n.created_at >= ${since}

        UNION ALL
        SELECT 'callback', cb.created_at, u.name, l.id, l.first_name, l.last_name,
               jsonb_build_object('scheduledAt', cb.scheduled_at)
        FROM callbacks cb
        JOIN leads l ON l.id = cb.lead_id
        LEFT JOIN users u ON u.id = cb.agent_id
        WHERE cb.created_at >= ${since}

        UNION ALL
        SELECT 'agent_sms', m.created_at, u.name, l.id, l.first_name, l.last_name,
               jsonb_build_object('body', m.body)
        FROM messages m
        JOIN leads l ON l.id = m.lead_id
        LEFT JOIN users u ON u.id = m.sent_by
        WHERE m.sent_by IS NOT NULL AND m.created_at >= ${since}
      ) feed
      ORDER BY at DESC
      LIMIT 50
    `),
  ]);

  const leads = leadRows.rows[0];
  const calls = callRows.rows[0];

  // Funnel stages, each a subset of the one before. "Interested" is the
  // disposition, which is the only signal an agent judged the lead worth it.
  const interested = agentRows.rows.reduce(
    (total, r) => total + Number((r.dispositions as Record<string, number>).interested ?? 0),
    0
  );

  return {
    period,
    since: new Date().toISOString(),
    kpis: {
      leadsReceived: leads.leads_received,
      responded: leads.responded,
      respondedPct: pct(leads.responded, leads.leads_received),
      completed: leads.completed,
      completedPct: pct(leads.completed, leads.leads_received),
      hot: leads.hot,
      callsMade: calls.calls_made,
      reached: calls.reached,
      reachedPct: pct(calls.reached, calls.calls_made),
      callbacksSet: callbackRows.rows[0].n,
      dncAdded: dncRows.rows[0].n,
    },
    funnel: [
      { stage: 'received', count: leads.leads_received },
      { stage: 'responded', count: leads.responded },
      { stage: 'completed', count: leads.completed },
      { stage: 'called', count: calls.calls_made },
      { stage: 'interested', count: interested },
    ],
    agents: agentRows.rows.map((r) => ({
      agentId: r.agent_id,
      name: r.name,
      calls: r.calls,
      reached: r.reached,
      avgCallSeconds: r.avg_call_seconds === null ? null : Math.round(Number(r.avg_call_seconds)),
      dispositions: r.dispositions,
      callbacksPending: r.callbacks_pending,
    })),
    activity: activityRows.rows.map((r) => ({
      kind: r.kind,
      at: r.at.toISOString(),
      agentName: r.agent_name,
      leadId: r.lead_id,
      leadName: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown',
      detail: r.detail,
    })),
    callsBuilt: false,
  };
}
