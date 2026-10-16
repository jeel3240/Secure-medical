/**
 * Leads whose first question never went out - one definition, used by the
 * opener retry (`worker/retry-openers.ts`) and by the resend after an outage
 * (`worker/send-waiting-openers.ts`). Until 2026-10-16 it lived inside the
 * retry; two copies of a rule like this drift, and the price of a drift is a
 * lead texted twice or never. `POLLER.md`, "Retrying a failed opener".
 *
 * **How a failed opener is recognised.** `worker/opener.ts` sets `expires_at`
 * only once the opener is actually accepted, so a conversation that is still
 * `open` with `expires_at IS NULL` never had one go out. That is the signature;
 * no new column is needed.
 *
 * Takes a `Querier` rather than the pool, like the other helpers in `db/`, so
 * it can run inside a caller's transaction.
 */

import type { Querier } from './sql';

export interface OpenerNeverSent {
  leadId: number;
  phone: string;
  firstName: string | null;
  /** The first question of the lead's own flow - docs/FLOWS.md. */
  template: string;
  /** Automated attempts that failed: the poller's own, then each retry. */
  attempts: number;
  /** When the newest of those failed. Null when none was ever made. */
  lastFailedAt: Date | null;
  /** When EZ Texting says the lead arrived, else when we saved it. */
  arrivedAt: Date;
}

/**
 * The failed attempts, read from the message rows `db/outbound.ts` leaves, so
 * the count survives a restart. A blocked number records nothing - that send
 * was never attempted - so it never adds to it.
 *
 * Automated sends only (`sent_by IS NULL`). An agent's own text that EZ Texting
 * refused is a failed row too, and until 2026-09-28 it counted as an opener
 * attempt: a few tries by an agent during an outage gave the lead up after
 * five minutes instead of nine hours. Found in review.
 */
const FAILED_OPENERS = `
  FROM messages m
  WHERE m.lead_id = l.id
    AND m.direction = 'outbound'
    AND m.delivery_status = 'failed'
    AND m.sent_by IS NULL
`;

/**
 * Every lead still waiting on its first question, oldest first - the longest
 * silent go first.
 *
 * `narrow` adds conditions of the caller's own, written against `l` (leads)
 * and `c` (the conversation), with `$1`... from its `params`.
 */
export async function findOpenersNeverSent(
  q: Querier,
  narrow?: { where: string; params: unknown[] }
): Promise<OpenerNeverSent[]> {
  const { rows } = await q.query(
    `SELECT l.id, l.phone, l.first_name,
            fq.body AS template,
            (SELECT count(*)::int ${FAILED_OPENERS}) AS attempts,
            (SELECT max(m.created_at) ${FAILED_OPENERS}) AS last_failed_at,
            COALESCE(l.ezt_added_at, l.created_at) AS arrived_at
     FROM leads l
     JOIN conversations c ON c.lead_id = l.id
     JOIN flow_questions fq ON fq.id = c.current_question_id
     WHERE c.status = 'open'
       AND c.expires_at IS NULL
       -- Still on the flow's first question with nothing answered. A lead who
       -- replied anyway has moved the conversation on, and the first question
       -- again would be scored as the answer to the next (review, 2026-09-28).
       AND c.score = 0
       AND NOT EXISTS (
         SELECT 1 FROM flow_questions earlier
         WHERE earlier.flow_id = fq.flow_id AND earlier.position < fq.position
       )
       AND NOT EXISTS (
         SELECT 1 FROM messages m WHERE m.lead_id = l.id AND m.direction = 'inbound'
       )
       -- Nothing of ours went out or may have: a 'sending' row counts, since
       -- that text may have been delivered - db/outbound.ts.
       AND NOT EXISTS (
         SELECT 1 FROM messages m
         WHERE m.lead_id = l.id AND m.direction = 'outbound'
           AND m.delivery_status IS DISTINCT FROM 'failed'
       )
       -- A blocked number is not a failure to retry, it is a number we must
       -- not text. sendMessage checks again anyway.
       AND NOT EXISTS (
         SELECT 1 FROM dnc_list d WHERE d.phone = l.phone AND d.released_at IS NULL
       )
       ${narrow ? `AND (${narrow.where})` : ''}
     ORDER BY arrived_at, l.id`,
    narrow?.params ?? []
  );

  return rows.map((row) => ({
    leadId: row.id as number,
    phone: row.phone as string,
    firstName: (row.first_name as string | null) ?? null,
    template: row.template as string,
    attempts: row.attempts as number,
    lastFailedAt: row.last_failed_at ? new Date(row.last_failed_at as Date) : null,
    arrivedAt: new Date(row.arrived_at as Date),
  }));
}
