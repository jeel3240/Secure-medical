/**
 * The lead card behind `GET /api/leads/:id`: who the lead is, what they
 * answered, what they scored and why, and the flags that change what an agent
 * may do.
 *
 * AGENT-WORKSPACE.md, "Endpoints"; DESIGN-PROMPT.md section 3.
 */

import { pool } from './pool';
import { answerChips, scoreBreakdown, type ScoringRule } from '../core/score-breakdown';
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
  } | null;

  chips: AnswerChip[];
  breakdown: BreakdownLine[];

  /** Who is working it, if anyone active. */
  claimedBy: { id: number; name: string; at: string } | null;

  flags: {
    /** A live dnc_list row: blocks every action, not just SMS. */
    dnc: boolean;
    /** Two unclear replies; the raw messages are worth reading. */
    needsReview: boolean;
    /** An inbound reply nobody has opened yet. */
    unread: boolean;
    /** Went quiet past its deadline. */
    expired: boolean;
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
    c.status, c.step, c.q1, c.q2, c.q3, c.score, c.tier,
    c.expires_at, c.agent_took_over_at,
    u.id   AS holder_id,
    u.name AS holder_name,
    l.assigned_at,
    (d.id IS NOT NULL) AS on_dnc
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT c.id, c.status, c.step, c.q1, c.q2, c.q3, c.score, c.tier,
           c.expires_at, c.agent_took_over_at
    FROM conversations c
    WHERE c.lead_id = l.id
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN users u ON u.id = l.assigned_to AND u.is_active
  LEFT JOIN dnc_list d ON d.phone = l.phone AND d.released_at IS NULL
  WHERE l.id = $1
`;

async function loadScoringRules(): Promise<ScoringRule[]> {
  const { rows } = await pool.query(
    `SELECT code, label, question, choice, points FROM scoring_rules`
  );
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    question: r.question,
    choice: r.choice,
    points: r.points,
  }));
}

/** Null when there is no such lead. */
export async function getLeadDetail(leadId: number): Promise<LeadDetail | null> {
  const { rows } = await pool.query(SQL, [leadId]);
  if (rows.length === 0) return null;

  const r = rows[0];
  const rules = await loadScoringRules();

  // A lead with no conversation has nothing to score or chip. That happens
  // today only in test data, but the card must not fall over on it.
  const conversation = r.conversation_id
    ? { q1: r.q1, q2: r.q2, q3: r.q3, status: r.status, score: r.score }
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
        }
      : null,

    chips: conversation ? answerChips(conversation, rules) : [],
    breakdown: conversation ? scoreBreakdown(conversation, rules) : [],

    claimedBy: r.holder_id
      ? { id: r.holder_id, name: r.holder_name, at: r.assigned_at?.toISOString() ?? '' }
      : null,

    flags: {
      dnc: r.on_dnc,
      needsReview: r.status === 'review',
      unread: r.has_unread_inbound,
      expired: r.status === 'expired',
    },
  };
}
