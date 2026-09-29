/**
 * Admin > Configuration: what we ask, and what each answer is worth.
 *
 * Read straight from `settings`, `scoring_rules` and `tiers` on every request,
 * never from a copy in the frontend. That is the whole point of the page - not
 * documentation of what we intended, but a window on the values the state
 * machine is actually using. ADMIN.md, "Configuration".
 *
 * Read-only: Jeel's decision, 2026-09-23. Changes go through a numbered
 * migration and a PR. There is no writer here and there should not be one.
 */

import { pool } from './pool';
import { NAME_FALLBACK, SEGMENT_LIMIT } from '../core/messages';

/** The seven messages the page shows, in the order a lead meets them. */
const MESSAGE_KEYS = [
  'question_1',
  'question_2',
  'question_3',
  'message_clarify_1',
  'message_clarify_2',
  'message_clarify_3',
  'message_thanks',
] as const;

export interface ConfiguredMessage {
  key: string;
  body: string;
  /**
   * Length as stored, with `{first_name}` left in place. `worstCaseLength` is
   * what actually decides the segment count.
   */
  length: number;
  /**
   * The longest this message can be once a name is substituted, using the
   * longest first name we currently hold. A message that fits in one segment
   * for "Jo" and not for "Christopher" costs two segments for some leads and
   * not others, and the page has to show that.
   */
  worstCaseLength: number;
  segments: number;
  /** True when some leads get a second segment. The screen flags these. */
  costsExtraSegment: boolean;
  /** Whether the copy contains {first_name} at all. */
  personalised: boolean;
}

export interface AdminConfig {
  messages: ConfiguredMessage[];
  scoring: {
    awards: { code: string; label: string | null; points: number }[];
    questions: {
      question: number;
      choices: { choice: string; label: string | null; points: number }[];
    }[];
    /** Response + completion + the best answer to each question. */
    maxScore: number;
  };
  tiers: { name: string; minScore: number; maxScore: number }[];
  /** Values the state machine reads that are not scoring or copy. */
  settings: { expiryDays: number; maxInvalidBeforeReview: number; segmentLimit: number };
  /** The longest first name on file, which drives worstCaseLength. */
  longestFirstName: string;
}

const segmentsFor = (length: number): number => Math.max(1, Math.ceil(length / SEGMENT_LIMIT));

/**
 * The longest first name we hold, or the fallback when there are no leads.
 *
 * Reading it per request rather than assuming a number: the point of the page
 * is live values, and "this message is one segment" is only true against the
 * names actually on file.
 */
async function longestFirstName(): Promise<string> {
  const { rows } = await pool.query(
    `SELECT first_name FROM leads
     WHERE first_name IS NOT NULL AND first_name <> ''
     ORDER BY length(first_name) DESC, first_name
     LIMIT 1`
  );
  const longest: string = rows[0]?.first_name ?? '';
  // The fallback is what renderMessage substitutes when there is no name, so a
  // shorter longest name must not make the worst case look better than it is.
  return longest.length > NAME_FALLBACK.length ? longest : NAME_FALLBACK;
}

export async function getAdminConfig(): Promise<AdminConfig> {
  const [settingsRows, scoringRows, tierRows, name] = await Promise.all([
    pool.query(`SELECT key, value FROM settings`),
    pool.query(`SELECT code, label, question, choice, points FROM scoring_rules ORDER BY question, choice`),
    pool.query(`SELECT name, min_score, max_score FROM tiers ORDER BY sort_order`),
    longestFirstName(),
  ]);

  const settings = new Map<string, string>(settingsRows.rows.map((r) => [r.key, r.value]));

  const messages: ConfiguredMessage[] = MESSAGE_KEYS.filter((key) => settings.has(key)).map((key) => {
    const body = settings.get(key)!;
    const personalised = body.includes('{first_name}');
    const worstCaseLength = personalised
      ? body.replace(/\{first_name\}/g, name).length
      : body.length;

    return {
      key,
      body,
      length: body.length,
      worstCaseLength,
      segments: segmentsFor(worstCaseLength),
      costsExtraSegment: worstCaseLength > SEGMENT_LIMIT,
      personalised,
    };
  });

  // question 0 is a flat award - responded, completed - rather than an answer.
  const awards = scoringRows.rows
    .filter((r) => r.question === 0)
    .map((r) => ({ code: r.code, label: r.label, points: r.points }));

  const questions = [1, 2, 3].map((question) => ({
    question,
    choices: scoringRows.rows
      .filter((r) => r.question === question)
      .map((r) => ({ choice: r.choice, label: r.label, points: r.points })),
  }));

  // What a lead who answers everything as well as possible can reach. Computed
  // from the rows rather than hardcoded at 100, so an edited rule shows here
  // instead of quietly disagreeing with the tier bands below it.
  const bestPerQuestion = questions.reduce(
    (total, q) => total + Math.max(0, ...q.choices.map((c) => c.points)),
    0
  );
  const maxScore = awards.reduce((total, a) => total + a.points, 0) + bestPerQuestion;

  const number = (key: string, fallback: number): number => {
    const parsed = Number(settings.get(key));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    messages,
    scoring: { awards, questions, maxScore },
    tiers: tierRows.rows.map((r) => ({
      name: r.name,
      minScore: r.min_score,
      maxScore: r.max_score,
    })),
    settings: {
      expiryDays: number('expiry_days', 7),
      maxInvalidBeforeReview: number('max_invalid_before_review', 1),
      segmentLimit: SEGMENT_LIMIT,
    },
    longestFirstName: name,
  };
}
