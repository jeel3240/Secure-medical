import { pool } from './pool';

/**
 * Status tabs on Admin > Leads, from DESIGN-PROMPT.md section 6g. Derived from
 * the lead's newest conversation rather than stored, so it stays true as the
 * state machine advances a conversation.
 */
export type LeadStatus =
  | 'awaiting_reply'
  | 'in_progress'
  | 'completed'
  | 'needs_review'
  | 'opted_out'
  | 'expired';

export interface AdminLeadRow {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  source: string | null;
  receivedAt: string | null;
  status: LeadStatus | null;
  stepReached: number | null;
  score: number | null;
  tier: string | null;
  lastActivityAt: string | null;
  lastActivityDirection: 'inbound' | 'outbound' | null;
}

export interface AdminLeadQuery {
  status?: LeadStatus | 'all';
  source?: string[];
  since?: Date;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminLeadPage {
  leads: AdminLeadRow[];
  total: number;
  counts: Record<string, number>;
  page: number;
  pageSize: number;
}

/**
 * A lead's newest conversation, and its most recent message. Both are
 * lateral joins so the row count stays one per lead however much history
 * accumulates.
 *
 * opted_out is checked against dnc_list as well as the conversation, because
 * the poller adds a suppressed contact to both and a lead can reach the list
 * without ever holding a conversation.
 */
const BASE = `
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT c.status, c.step, c.q1, c.q2, c.q3, c.score, c.tier
    FROM conversations c
    WHERE c.lead_id = l.id
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT m.created_at, m.received_at, m.direction
    FROM messages m
    WHERE m.lead_id = l.id
    ORDER BY COALESCE(m.received_at, m.created_at) DESC, m.id DESC
    LIMIT 1
  ) m ON true
  LEFT JOIN dnc_list d ON d.phone = l.phone AND d.released_at IS NULL
`;

/**
 * Mirrors the tabs in the spec. Ordering matters: opted_out wins over
 * everything, and an open conversation splits on whether any question has been
 * answered.
 */
const STATUS_SQL = `
  CASE
    WHEN d.id IS NOT NULL OR c.status = 'suppressed' THEN 'opted_out'
    WHEN c.status = 'review' THEN 'needs_review'
    WHEN c.status = 'completed' THEN 'completed'
    WHEN c.status = 'expired' THEN 'expired'
    WHEN c.status = 'open' AND (c.q1 IS NOT NULL OR c.q2 IS NOT NULL OR c.q3 IS NOT NULL)
      THEN 'in_progress'
    WHEN c.status = 'open' THEN 'awaiting_reply'
    ELSE NULL
  END
`;

/** Highest question answered, which is what "Step reached" shows. */
const STEP_SQL = `
  CASE
    WHEN c.q3 IS NOT NULL THEN 3
    WHEN c.q2 IS NOT NULL THEN 2
    WHEN c.q1 IS NOT NULL THEN 1
    ELSE NULL
  END
`;

function buildFilters(query: AdminLeadQuery): { sql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (query.status && query.status !== 'all') {
    values.push(query.status);
    clauses.push(`${STATUS_SQL} = $${values.length}`);
  }

  if (query.source?.length) {
    values.push(query.source);
    clauses.push(`l.source = ANY($${values.length}::text[])`);
  }

  if (query.since) {
    values.push(query.since);
    clauses.push(`COALESCE(l.ezt_added_at, l.created_at) >= $${values.length}`);
  }

  if (query.q) {
    // Phone is searched with punctuation stripped, so "(602) 620-3572" matches
    // the stored +16026203572.
    values.push(`%${query.q.toLowerCase()}%`);
    const like = `$${values.length}`;
    values.push(`%${query.q.replace(/\D/g, '')}%`);
    const digits = `$${values.length}`;
    clauses.push(`(
      lower(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) LIKE ${like}
      OR (${digits} <> '%%' AND l.phone LIKE ${digits})
    )`);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

export async function listAdminLeads(query: AdminLeadQuery): Promise<AdminLeadPage> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

  const { sql: where, values } = buildFilters(query);

  const rows = await pool.query(
    `SELECT l.id, l.phone, l.first_name, l.last_name, l.source,
            COALESCE(l.ezt_added_at, l.created_at) AS received_at,
            ${STATUS_SQL} AS status,
            ${STEP_SQL} AS step_reached,
            c.score, c.tier,
            COALESCE(m.received_at, m.created_at) AS last_activity_at,
            m.direction AS last_activity_direction
     ${BASE}
     ${where}
     ORDER BY COALESCE(l.ezt_added_at, l.created_at) DESC, l.id DESC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    values
  );

  const totalResult = await pool.query(`SELECT count(*)::int AS total ${BASE} ${where}`, values);

  // Tab counts ignore the status filter but honour the others, so switching
  // tabs does not change the numbers next to them.
  const countFilters = buildFilters({ ...query, status: undefined });
  const countsResult = await pool.query(
    `SELECT ${STATUS_SQL} AS status, count(*)::int AS n
     ${BASE} ${countFilters.sql}
     GROUP BY 1`,
    countFilters.values
  );

  const counts: Record<string, number> = { all: 0 };
  for (const row of countsResult.rows) {
    if (row.status) counts[row.status] = row.n;
    counts.all += row.n;
  }

  return {
    leads: rows.rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      firstName: r.first_name,
      lastName: r.last_name,
      source: r.source,
      receivedAt: r.received_at?.toISOString() ?? null,
      status: r.status,
      stepReached: r.step_reached,
      // The running score, not only the final one. Scoring starts at the first
      // reply, so a lead part-way through has a real score and tier worth
      // seeing. A score of 0 means no reply yet and shows as blank rather than
      // "0", which would read as a judgement rather than an absence.
      score: r.score > 0 ? r.score : null,
      tier: r.score > 0 ? r.tier : null,
      lastActivityAt: r.last_activity_at?.toISOString() ?? null,
      lastActivityDirection: r.last_activity_direction,
    })),
    total: totalResult.rows[0].total,
    counts,
    page,
    pageSize,
  };
}

/** Distinct sources, for the filter dropdown. */
export async function listLeadSources(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT source FROM leads WHERE source IS NOT NULL ORDER BY source`
  );
  return rows.map((r) => r.source);
}

/**
 * When the poller last advanced its checkpoint. The page warns when this is
 * older than three poll intervals, which is the spec's signal that the worker
 * has stopped.
 */
export async function lastPollAt(): Promise<{ at: string | null; intervalSeconds: number }> {
  const { rows } = await pool.query(
    `SELECT key, value, updated_at FROM settings
     WHERE key IN ('ezt_poll_checkpoint', 'poll_interval_seconds')`
  );

  const checkpoint = rows.find((r) => r.key === 'ezt_poll_checkpoint');
  const interval = rows.find((r) => r.key === 'poll_interval_seconds');

  return {
    at: checkpoint?.updated_at?.toISOString() ?? null,
    intervalSeconds: Number(interval?.value ?? 60),
  };
}
