import { questionShort } from '../core/questions';
import { CLOSED_SQL, WORKED_SQL } from './lead-state';
import { likeLiteral } from './sql';
import { pool } from './pool';

/**
 * Status tabs on Admin > Leads, from DESIGN-PROMPT.md section 6g. Derived, not
 * stored, so a status stays true as the conversation advances and agents work
 * the lead.
 *
 * A lead's whole life, in order - Jeel, 2026-09-28:
 *
 *   awaiting_reply -> answering -> ready -> working -> closed
 *
 * with needs_review, expired and opted_out as the ways the SMS part can end
 * otherwise. `answering` was called `in_progress` and `ready` was
 * `completed`, renamed the same day (briefly `ready_to_call`, which read as an
 * instruction): "In progress" also means an agent holding
 * a lead on the queue, and "Completed" read as finished when the calling had
 * not started. ADMIN-LEADS.md, "Status".
 */
export type LeadStatus =
  | 'awaiting_reply'
  | 'answering'
  | 'ready'
  /** Asked for special offers only - not a call to make. docs/FLOWS.md. */
  | 'offers'
  /** Said No to the offers and to a rep: wants neither. Nothing to do. */
  | 'declined'
  | 'working'
  | 'closed'
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
  /**
   * The question the lead is on now, or stopped at, as the screens say it -
   * "Q2", "Offers" (`core/questions.ts`) - or `done` once the questions are
   * finished. Null when no question ever went out (blocked on arrival).
   */
  step: string | null;
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
 * A lead and its newest conversation - a lateral join, so the row count stays
 * one per lead however much history accumulates. Everything a status or a
 * filter is worked out from, and nothing else: the last message is joined
 * later, for the page's rows only (`listAdminLeads`).
 *
 * opted_out is checked against dnc_list as well as the conversation, because
 * the poller adds a suppressed contact to both and a lead can reach the list
 * without ever holding a conversation.
 */
const BASE = `
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT c.id, c.status, c.step, c.score, c.tier, c.end_outcome, c.current_question_id
    FROM conversations c
    WHERE c.lead_id = l.id
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN dnc_list d ON d.phone = l.phone AND d.released_at IS NULL
`;

/** When the lead reached us - the page's order, and what `since` filters on. */
const RECEIVED = `COALESCE(l.ezt_added_at, l.created_at)`;

/**
 * The first match wins, so the order is the rule:
 *
 * 1. opted_out - a blocked number overrides everything.
 * 2. closed - an agent pressed Closed.
 * 3. working - an agent has done something with it. This outranks every SMS
 *    status: once a person is on a lead, what the conversation says matters
 *    less than that someone is handling it - a needs-review or expired lead an
 *    agent is working reads Working.
 * 4. the conversation: needs_review, offers (asked for offers only, so not
 *    Ready for an agent), ready, expired, then an open one
 *    split on whether any question has been answered.
 *
 * `db/lead-state.ts` defines closed and working, shared with the queue.
 */
const STATUS_SQL = `
  CASE
    WHEN d.id IS NOT NULL OR c.status = 'suppressed' THEN 'opted_out'
    WHEN ${CLOSED_SQL} THEN 'closed'
    WHEN ${WORKED_SQL} THEN 'working'
    WHEN c.status = 'review' THEN 'needs_review'
    WHEN c.status = 'completed' AND c.end_outcome = 'offers' THEN 'offers'
    WHEN c.status = 'completed' AND c.end_outcome = 'declined' THEN 'declined'
    WHEN c.status = 'completed' THEN 'ready'
    WHEN c.status = 'expired' THEN 'expired'
    -- One look-up for this conversation. Written as EXISTS it was planned as a
    -- read of every answer ever given, once per statement.
    WHEN c.status = 'open'
      AND (SELECT 1 FROM conversation_answers ca WHERE ca.conversation_id = c.id LIMIT 1) IS NOT NULL
      THEN 'answering'
    WHEN c.status = 'open' THEN 'awaiting_reply'
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
    clauses.push(`${RECEIVED} >= $${values.length}`);
  }

  if (query.q) {
    // Phone is searched with punctuation stripped, so "(602) 620-3572" matches
    // the stored +16026203572.
    // Escaped, so a "%" or "_" in the box is that character, not a wildcard.
    values.push(`%${likeLiteral(query.q.toLowerCase())}%`);
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

/**
 * One page of leads, and the count under every tab.
 *
 * **Two statements, each doing its work once** - 2026-10-06. There were three,
 * and each worked out every lead's status and last message from scratch:
 *
 * - The tab counts come first. Nothing in them needs a message, so they no
 *   longer look one up per lead.
 * - The total was a third pass that always came to a number the counts already
 *   held - the chosen tab's, or all of them. It is read from them now.
 * - The page picks its rows first - filter, order, limit - and only then joins
 *   each row's last message and the question it is on: fifty look-ups, not one
 *   per lead in the table. With no status filter and the index from migration
 *   013 it reads just those fifty leads.
 *
 * Timed against 50,000 leads: docs/ADMIN-LEADS.md, "How fast it is".
 */
export async function listAdminLeads(query: AdminLeadQuery): Promise<AdminLeadPage> {
  const page = Math.max(1, Math.trunc(query.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

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
  const total = query.status && query.status !== 'all' ? (counts[query.status] ?? 0) : counts.all;

  const { sql: where, values } = buildFilters(query);
  const rows = await pool.query(
    `SELECT p.*,
            COALESCE(m.received_at, m.created_at) AS last_activity_at,
            m.direction AS last_activity_direction,
            fq.key AS question_key, fq.heading AS question_heading
     FROM (
       SELECT l.id, l.phone, l.first_name, l.last_name, l.source,
              ${RECEIVED} AS received_at,
              ${STATUS_SQL} AS status,
              c.status AS conversation_status, c.step, c.score, c.tier, c.current_question_id
       ${BASE}
       ${where}
       ORDER BY ${RECEIVED} DESC, l.id DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
     ) p
     LEFT JOIN LATERAL (
       SELECT m.created_at, m.received_at, m.direction
       FROM messages m
       -- A send EZ Texting refused is not activity: nothing reached anyone.
       WHERE m.lead_id = p.id AND m.delivery_status IS DISTINCT FROM 'failed'
       ORDER BY COALESCE(m.received_at, m.created_at) DESC, m.id DESC
       LIMIT 1
     ) m ON true
     LEFT JOIN flow_questions fq ON fq.id = p.current_question_id
     ORDER BY p.received_at DESC, p.id DESC`,
    values
  );

  return {
    leads: rows.rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      firstName: r.first_name,
      lastName: r.last_name,
      source: r.source,
      receivedAt: r.received_at?.toISOString() ?? null,
      status: r.status,
      step: stepLabel(r),
      // The running score, not only the final one. Scoring starts at the first
      // reply, so a lead part-way through has a real score and tier worth
      // seeing. A score of 0 means no reply yet and shows as blank rather than
      // "0", which would read as a judgement rather than an absence.
      score: r.score > 0 ? r.score : null,
      tier: r.score > 0 ? r.tier : null,
      lastActivityAt: r.last_activity_at?.toISOString() ?? null,
      lastActivityDirection: r.last_activity_direction,
    })),
    total,
    counts,
    page,
    pageSize,
  };
}

/**
 * The Step column: the question the lead is on now - which the state machine
 * moves on after each valid answer - or `done` once the questions are
 * finished. A lead that went quiet reads the question it never answered,
 * which is where it dropped off.
 *
 * By the question's own name - "Q2", "Offers" - since 2026-10-06; it was the
 * bare position, and the antibiotics flow's offers question, asked second of
 * a lead who said No, read "Q4". A conversation that names no question (an
 * older row) falls back to its position.
 */
function stepLabel(r: {
  conversation_status: string | null;
  step: number | null;
  question_key: string | null;
  question_heading: string | null;
}): string | null {
  if (r.conversation_status === 'completed') return 'done';
  if (r.conversation_status === 'suppressed') return null;
  if (r.question_key && r.question_heading) return questionShort({ key: r.question_key, heading: r.question_heading });
  return r.step ? `Q${r.step}` : null;
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
