/**
 * Admin > DNC list: every number ever blocked, released or not.
 *
 * Read-only, with no manual add and no delete - Jeel, 2026-09-23. A number
 * reaches this list through an agent's DNC disposition, an SMS STOP, or an EZ
 * Texting opt-out found by the poller; it leaves only by the lead texting
 * START, which keeps the row and stamps `released_at`. ADMIN.md, "DNC list".
 *
 * Released rows are shown as released rather than hidden, or the list stops
 * matching who is actually blocked.
 */

import { pool } from './pool';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface DncRow {
  phone: string;
  reason: string;
  addedAt: string;
  releasedAt: string | null;
  releasedReason: string | null;
  /** The live state, which is what the screen colours on. */
  blocked: boolean;
  /** The lead we hold for this number, if any. A number can be blocked without one. */
  lead: { id: number; name: string } | null;
}

export interface DncQuery {
  q?: string;
  page?: number;
  limit?: number;
  /** Default 'all': hiding released rows would misrepresent the list. */
  state?: 'all' | 'blocked' | 'released';
}

export interface DncResult {
  rows: DncRow[];
  total: number;
  page: number;
  limit: number;
  counts: { all: number; blocked: number; released: number };
}

/**
 * Escapes what the admin typed for LIKE. Without this a search box holding "%"
 * or "_" is a wildcard and matches numbers it has nothing to do with.
 */
function likeLiteral(text: string): string {
  return text.replace(/[\%_]/g, (c) => `\${c}`);
}

export async function listDnc(query: DncQuery = {}): Promise<DncResult> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(query.page ?? 1, 1);

  const values: unknown[] = [];
  const where: string[] = [];

  if (query.q?.trim()) {
    // Digits only, so a search for "(602) 555-0142" finds +16025550142. The
    // stored phone is stripped the same way for the comparison.
    const digits = query.q.replace(/\D/g, '');
    if (digits) {
      values.push(`%${likeLiteral(digits)}%`);
      where.push(`regexp_replace(d.phone, '\D', '', 'g') LIKE $${values.length}`);
    } else {
      // Not a number: match the lead's name instead.
      values.push(`%${likeLiteral(query.q.trim())}%`);
      where.push(
        `(l.first_name ILIKE $${values.length} OR l.last_name ILIKE $${values.length})`
      );
    }
  }

  if (query.state === 'blocked') where.push('d.released_at IS NULL');
  if (query.state === 'released') where.push('d.released_at IS NOT NULL');

  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // The lead join is LEFT and may match nothing: a number can be blocked before
  // we ever hold a lead for it, which is the point of blocking without one.
  const from = `
    FROM dnc_list d
    LEFT JOIN leads l ON l.phone = d.phone
  `;

  const [rows, totals] = await Promise.all([
    pool.query(
      `SELECT d.phone, d.reason, d.added_at, d.released_at, d.released_reason,
              l.id AS lead_id, l.first_name, l.last_name
       ${from}
       ${filter}
       ORDER BY d.added_at DESC, d.phone
       LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      values
    ),
    // Counts ignore the state filter so every tab's number is right whichever
    // tab is open, the way the callback tabs work.
    pool.query(
      `SELECT count(*)::int AS all,
              count(*) FILTER (WHERE d.released_at IS NULL)::int AS blocked,
              count(*) FILTER (WHERE d.released_at IS NOT NULL)::int AS released
       ${from}
       ${where.filter((c) => !c.startsWith('d.released_at')).length ? `WHERE ${where.filter((c) => !c.startsWith('d.released_at')).join(' AND ')}` : ''}`,
      values
    ),
  ]);

  const counts = totals.rows[0];
  const total =
    query.state === 'blocked' ? counts.blocked : query.state === 'released' ? counts.released : counts.all;

  return {
    rows: rows.rows.map((r) => ({
      phone: r.phone,
      reason: r.reason,
      addedAt: r.added_at.toISOString(),
      releasedAt: r.released_at?.toISOString() ?? null,
      releasedReason: r.released_reason,
      blocked: r.released_at === null,
      lead: r.lead_id
        ? { id: r.lead_id, name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown' }
        : null,
    })),
    total,
    page,
    limit,
    counts: { all: counts.all, blocked: counts.blocked, released: counts.released },
  };
}
