/**
 * Flows in the database - docs/FLOWS.md, migration 012.
 *
 * A flow is the script a lead is taken through: its questions, each question's
 * choices, and for each choice the reply, the points and where to go next.
 * This file reads them; `core/state-machine.ts` follows them.
 *
 * Read on every use, never cached: a flow is changed by a migration, and the
 * change should apply to the next reply rather than after a restart.
 */

import type { Flow, FlowChoice, FlowQuestion } from '../core/state-machine';
/** A pool or a client in a transaction. */
export interface Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

/** One flow, whole. Null when it does not exist. */
export async function loadFlow(q: Db, flowId: number): Promise<Flow | null> {
  const [flows, questions, choices] = await Promise.all([
    q.query(
      `SELECT id, key, responded_points, completed_points, review_body FROM flows WHERE id = $1`,
      [flowId]
    ),
    q.query(
      `SELECT id, key, position, body, clarify_body, heading
       FROM flow_questions WHERE flow_id = $1 ORDER BY position`,
      [flowId]
    ),
    q.query(
      `SELECT c.question_id, c.choice, c.label, c.words, c.points, c.reply_body, c.next_question_id, c.ending
       FROM flow_choices c
       JOIN flow_questions fq ON fq.id = c.question_id
       WHERE fq.flow_id = $1
       ORDER BY c.question_id, c.choice`,
      [flowId]
    ),
  ]);

  const flow = flows.rows[0];
  if (!flow) return null;

  const byQuestion = new Map<number, FlowChoice[]>();
  for (const c of choices.rows) {
    const list = byQuestion.get(c.question_id) ?? [];
    list.push({
      choice: c.choice,
      label: c.label,
      words: c.words ?? [],
      points: c.points,
      reply: c.reply_body,
      nextQuestionId: c.next_question_id,
      ending: c.ending,
    });
    byQuestion.set(c.question_id, list);
  }

  return {
    id: flow.id,
    key: flow.key,
    respondedPoints: flow.responded_points,
    completedPoints: flow.completed_points,
    reviewBody: flow.review_body,
    questions: questions.rows.map(
      (r): FlowQuestion => ({
        id: r.id,
        key: r.key,
        position: r.position,
        body: r.body,
        clarifyBody: r.clarify_body,
        heading: r.heading,
        choices: byQuestion.get(r.id) ?? [],
      })
    ),
  };
}

/**
 * Starts a lead's conversation in the flow new leads get: on its first
 * question when `open`, on none when `suppressed` (a blocked number is saved
 * so its arrival is visible, and is never asked anything).
 *
 * Throws when no flow is active. A lead with no conversation would sit in the
 * database unseen and unasked; failing the poll leaves the checkpoint where it
 * was, so the lead is picked up again once a flow is active.
 */
export async function startConversation(
  q: Db,
  leadId: number,
  status: 'open' | 'suppressed'
): Promise<void> {
  const { rowCount } = await q.query(
    `INSERT INTO conversations (lead_id, status, step, flow_id, current_question_id)
     SELECT $1, $2,
            CASE WHEN $2 = 'open' THEN first.position END,
            f.id,
            CASE WHEN $2 = 'open' THEN first.id END
     FROM flows f
     JOIN LATERAL (
       SELECT fq.id, fq.position FROM flow_questions fq
       WHERE fq.flow_id = f.id ORDER BY fq.position LIMIT 1
     ) first ON true
     WHERE f.is_active`,
    [leadId, status]
  );
  if (rowCount !== 1) {
    throw new Error('No active flow with a first question: cannot start a conversation. See docs/FLOWS.md.');
  }
}

/**
 * The first text for a lead: the question their open conversation is on, as a
 * template. Null when there is nothing to send - no open conversation.
 */
export async function openingQuestion(q: Db, leadId: number): Promise<string | null> {
  const { rows } = await q.query(
    `SELECT fq.body
     FROM conversations c
     JOIN flow_questions fq ON fq.id = c.current_question_id
     WHERE c.lead_id = $1 AND c.status = 'open'
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1`,
    [leadId]
  );
  return rows[0]?.body ?? null;
}
