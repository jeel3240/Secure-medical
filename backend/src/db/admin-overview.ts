/**
 * Admin > Overview: the period's numbers, the per-agent table and the recent
 * activity feed. ADMIN.md, "Overview"; DESIGN-PROMPT.md 6a.
 *
 * **No funnel since 2026-09-28** - Jeel: it drew the same numbers as the cards
 * above it, as bars. The per-agent rows gained what a superadmin checks each
 * morning instead: how many leads each agent is holding now, how many they
 * closed, and when they last did anything.
 *
 * Everything is derived on the read. Nothing here is stored as a running total:
 * at 50-100 leads a day the queries are cheap, and a stale counter is worse
 * than a slow one.
 *
 * **Live system status is not here.** Last poll, last webhook and worker health
 * come from the health endpoint - `LOGGING.md` - so that anything monitoring
 * the system from outside reads exactly what this screen does.
 *
 * **Only what the page shows - Jeel, 2026-09-28: "we are making the system
 * complex".** Calls made, reached, average call length, HOT, callbacks set, DNC
 * added and the per-agent outcome breakdown were all computed here and are
 * gone. The call figures were zero until Twilio anyway (Phase 4 adds them back
 * if the client wants them); the rest were numbers nobody acted on.
 */

import { CLOSING_DISPOSITIONS } from '../core/dispositions';
import { pool } from './pool';
import { startOfTodaySql } from './sql';

export type OverviewPeriod = 'today' | '7d' | '30d';

/**
 * Start of the window. `today` is midnight in the viewer's zone, not the last
 * 24 hours and not midnight UTC - `db/sql.ts`, `startOfTodaySql`.
 */
function sinceSql(period: OverviewPeriod, timeZone?: string): string {
  if (period === 'today') return startOfTodaySql(timeZone);
  return period === '7d' ? `now() - interval '7 days'` : `now() - interval '30 days'`;
}

export interface AgentRow {
  agentId: number;
  name: string;
  /** Open callbacks due now or overdue - not ones booked for later. */
  callbacksDue: number;
  /** Leads this agent holds right now, whatever the period. */
  holding: number;
  /** Leads this agent closed in the period - `closed`, and the retired values that meant the same. */
  closed: number;
  /** This agent's newest action of any kind - a note, callback, outcome, call or SMS. Null if none. */
  lastActiveAt: string | null;
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
    /** Leads whose first reply came in the period. */
    responded: number;
    /** Leads whose third answer came in the period - `completed_at`. */
    completed: number;
    /** Closed in the period - `closed`, and the retired values that meant the same. */
    closed: number;
  };
  agents: AgentRow[];
  activity: ActivityEntry[];
}

export async function getOverview(period: OverviewPeriod, timeZone?: string): Promise<Overview> {
  const since = sinceSql(period, timeZone);

  // Leads are counted by when they reached us - ezt_added_at where EZ Texting
  // gave us one, created_at otherwise - the same expression the queue uses for
  // a lead's age.
  const received = `COALESCE(l.ezt_added_at, l.created_at)`;

  // `closed` and the retired values that meant the same, so leads closed under
  // the old list still count. Constants from core/dispositions.ts, never input.
  const closing = CLOSING_DISPOSITIONS.map((v) => `'${v.replace(/[^a-z_]/g, '')}'`).join(', ');

  const [leadRows, agentRows, activityRows] = await Promise.all([
    // Every total counts things that *happened* in the period - Jeel,
    // 2026-09-28, "i want all real". Until then Replied and Answered all 3
    // counted leads that *arrived* in the period, so a lead who arrived
    // yesterday and answered today counted under yesterday, and Closed counted
    // presses of the button, so a lead closed twice counted twice.
    pool.query(`
      SELECT
        (SELECT count(*)::int FROM leads l WHERE ${received} >= ${since}) AS leads_received,
        -- A lead's first reply ever. A lead writing again weeks later has
        -- already replied, and is not counted a second time.
        (
          SELECT count(*)::int FROM (
            SELECT min(COALESCE(received_at, created_at)) AS first_reply
            FROM messages WHERE direction = 'inbound'
            GROUP BY lead_id
          ) r WHERE r.first_reply >= ${since}
        ) AS responded,
        -- completed_at, migration 004: when the third answer arrived.
        (
          SELECT count(DISTINCT lead_id)::int FROM conversations
          WHERE completed_at >= ${since}
        ) AS completed,
        -- Leads, not presses.
        (
          SELECT count(DISTINCT lead_id)::int FROM dispositions
          WHERE value IN (${closing}) AND created_at >= ${since}
        ) AS closed
    `),

    pool.query(`
      SELECT
        u.id AS agent_id,
        u.name,
        (
          SELECT count(DISTINCT d.lead_id)::int FROM dispositions d
          WHERE d.agent_id = u.id AND d.value IN (${closing}) AND d.created_at >= ${since}
        ) AS closed,
        -- Due today - overdue ones included, next week's not. It counted only
        -- those already due, so a callback at 3 PM showed nothing all
        -- morning, and a manager could not see who had calls to make that
        -- day - Jeel, 2026-09-29. "Today" ends at the viewer's midnight.
        (
          SELECT count(*)::int FROM callbacks cb
          WHERE cb.agent_id = u.id AND cb.done_at IS NULL
            AND cb.scheduled_at < (${startOfTodaySql(timeZone)} + interval '1 day')
        ) AS callbacks_due,
        (SELECT count(*)::int FROM leads hl WHERE hl.assigned_to = u.id) AS holding,
        (
          SELECT max(at) FROM (
            SELECT max(created_at) AS at FROM dispositions WHERE agent_id = u.id
            UNION ALL SELECT max(created_at) FROM notes WHERE agent_id = u.id
            UNION ALL SELECT max(created_at) FROM callbacks WHERE agent_id = u.id
            UNION ALL SELECT max(started_at) FROM calls WHERE agent_id = u.id
            UNION ALL SELECT max(created_at) FROM messages
              WHERE sent_by = u.id AND delivery_status IS DISTINCT FROM 'failed'
          ) acts
        ) AS last_active_at
      FROM users u
      WHERE u.is_active
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
        WHERE m.sent_by IS NOT NULL AND m.delivery_status IS DISTINCT FROM 'failed'
          AND m.created_at >= ${since}
      ) feed
      ORDER BY at DESC
      LIMIT 50
    `),
  ]);

  const leads = leadRows.rows[0];

  return {
    period,
    since: new Date().toISOString(),
    kpis: {
      leadsReceived: leads.leads_received,
      responded: leads.responded,
      completed: leads.completed,
      closed: leads.closed,
    },
    agents: agentRows.rows.map((r) => ({
      agentId: r.agent_id,
      name: r.name,
      callbacksDue: r.callbacks_due,
      holding: r.holding,
      closed: r.closed,
      lastActiveAt: r.last_active_at?.toISOString() ?? null,
    })),
    activity: activityRows.rows.map((r) => ({
      kind: r.kind,
      at: r.at.toISOString(),
      agentName: r.agent_name,
      leadId: r.lead_id,
      leadName: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown',
      detail: r.detail,
    })),
  };
}
