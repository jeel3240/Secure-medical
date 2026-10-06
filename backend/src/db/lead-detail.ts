/**
 * The lead card behind `GET /api/leads/:id`: who the lead is, what they
 * answered, what they scored and why, and the flags that change what an agent
 * may do.
 *
 * AGENT-WORKSPACE.md, "Endpoints"; DESIGN-PROMPT.md section 3.
 */

import { pool } from './pool';
import { questionShort } from '../core/questions';
import { CLOSED_SQL, MISSED_CALL_SQL } from './lead-state';
import { answerChips, scoreBreakdown, type SavedAnswer } from '../core/score-breakdown';
import type { AnswerChip, BreakdownLine } from '../core/score-breakdown';

export interface LeadDetail {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  source: string | null;
  /** When the lead reached us: what the card's ticking age counts from. */
  receivedAt: string | null;

  conversation: {
    id: number;
    status: string;
    step: number | null;
    score: number;
    tier: string | null;
    expiresAt: string | null;
    /** Set once an agent takes the conversation over - STATE-MACHINE.md 2b. */
    agentTookOverAt: string | null;
    /**
     * The question the lead is on, or stopped at, as the screens say it: "Q2",
     * "Offers" - `core/questions.ts`. Null once the questions are finished.
     */
    question: string | null;
    /** Which flow the lead is in: 'antibiotics'. */
    flow: string | null;
    /** How the flow ended: completed, offers, wants_contact - or null. */
    endOutcome: string | null;
  } | null;

  chips: AnswerChip[];
  breakdown: BreakdownLine[];

  /** Who is working it, if anyone active. */
  claimedBy: { id: number; name: string; at: string } | null;
  /**
   * Set while the lead is closed - by the same rule the queue and Admin > Leads
   * use, `db/lead-state.ts` - with who closed it and when. Null once a text or
   * a later callback reopens it. Added 2026-09-29: without it the screen could
   * not say a lead was closed, and an agent pressed Closed twice.
   */
  closed: { by: string | null; at: string } | null;

  flags: {
    /** A live dnc_list row: blocks every action, not just SMS. */
    dnc: boolean;
    /** Two unclear replies; the raw messages are worth reading. */
    needsReview: boolean;
    /** An inbound reply nobody has opened yet. */
    unread: boolean;
    /** Went quiet past its deadline. */
    expired: boolean;
    /** The lead rang us, nobody answered, and nobody has called or texted back. */
    missedCall: boolean;
  };
}

/**
 * The lead's newest conversation, the agent holding it, and whether the number
 * is blocked. Lateral join for the conversation so history cannot multiply
 * rows; the `dnc_list` join ignores released rows, because a number that opted
 * out and later texted START is contactable again - migration 002.
 */
const SQL = `
  SELECT
    l.id, l.phone, l.first_name, l.last_name, l.email, l.source,
    COALESCE(l.ezt_added_at, l.created_at) AS received_at,
    l.has_unread_inbound,
    c.id   AS conversation_id,
    c.status, c.step, c.score, c.tier, c.end_outcome,
    c.expires_at, c.agent_took_over_at,
    f.key AS flow_key, f.responded_points, f.completed_points,
    cq.key AS question_key, cq.heading AS question_heading,
    -- What they answered, as it was saved - docs/FLOWS.md.
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'questionKey', a.question_key, 'position', a.position, 'heading', a.heading,
              'choice', a.choice, 'label', a.label, 'points', a.points) ORDER BY a.position), '[]'::jsonb)
     FROM conversation_answers a WHERE a.conversation_id = c.id) AS answers,
    u.id   AS holder_id,
    u.name AS holder_name,
    l.assigned_at,
    (d.id IS NOT NULL) AS on_dnc,
    ${CLOSED_SQL} AS is_closed,
    ${MISSED_CALL_SQL} AS missed_call,
    od.created_at AS outcome_at,
    ou.name AS outcome_by
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT c.id, c.status, c.step, c.flow_id, c.current_question_id, c.end_outcome,
           c.score, c.tier, c.expires_at, c.agent_took_over_at
    FROM conversations c
    WHERE c.lead_id = l.id
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN flows f ON f.id = c.flow_id
  LEFT JOIN flow_questions cq ON cq.id = c.current_question_id
  LEFT JOIN users u ON u.id = l.assigned_to AND u.is_active
  LEFT JOIN dnc_list d ON d.phone = l.phone AND d.released_at IS NULL
  LEFT JOIN LATERAL (
    SELECT od.agent_id, od.created_at FROM dispositions od
    WHERE od.lead_id = l.id
    ORDER BY od.created_at DESC, od.id DESC
    LIMIT 1
  ) od ON true
  LEFT JOIN users ou ON ou.id = od.agent_id
  WHERE l.id = $1
`;

/**
 * The question a conversation is on, or stopped at. From the question itself
 * where the conversation still names one; from the bare `step` for a row that
 * does not, so an older one still reads "Q2".
 */
function questionLabel(r: { question_key: string | null; question_heading: string | null; step: number | null; status: string }): string | null {
  if (r.status === 'completed' || r.status === 'suppressed') return null;
  if (r.question_key && r.question_heading) return questionShort({ key: r.question_key, heading: r.question_heading });
  return r.step ? `Q${r.step}` : null;
}

/** Null when there is no such lead. */
export async function getLeadDetail(leadId: number): Promise<LeadDetail | null> {
  const { rows } = await pool.query(SQL, [leadId]);
  if (rows.length === 0) return null;

  const r = rows[0];
  // A lead with no conversation has nothing to score or chip. That happens
  // today only in test data, but the card must not fall over on it.
  const answers: SavedAnswer[] = r.conversation_id ? (r.answers ?? []) : [];
  const scored = r.conversation_id
    ? {
        score: r.score,
        endOutcome: r.end_outcome,
        respondedPoints: r.responded_points ?? 0,
        completedPoints: r.completed_points ?? 0,
      }
    : null;

  return {
    id: r.id,
    phone: r.phone,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    source: r.source,
    receivedAt: r.received_at?.toISOString() ?? null,

    conversation: r.conversation_id
      ? {
          id: r.conversation_id,
          status: r.status,
          step: r.step,
          score: r.score,
          tier: r.tier,
          expiresAt: r.expires_at?.toISOString() ?? null,
          agentTookOverAt: r.agent_took_over_at?.toISOString() ?? null,
          question: questionLabel(r),
          flow: r.flow_key ?? null,
          endOutcome: r.end_outcome ?? null,
        }
      : null,

    chips: answerChips(answers),
    breakdown: scored ? scoreBreakdown(scored, answers) : [],

    claimedBy: r.holder_id
      ? { id: r.holder_id, name: r.holder_name, at: r.assigned_at?.toISOString() ?? '' }
      : null,

    closed: r.is_closed
      ? { by: r.outcome_by ?? null, at: r.outcome_at?.toISOString() ?? '' }
      : null,

    flags: {
      dnc: r.on_dnc,
      needsReview: r.status === 'review',
      unread: r.has_unread_inbound,
      expired: r.status === 'expired',
      missedCall: r.missed_call,
    },
  };
}
