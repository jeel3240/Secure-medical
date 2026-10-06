/**
 * Admin > Configuration: what we ask, and what each answer is worth.
 *
 * Read straight from the active flow (`flows`, `flow_questions`, `flow_choices` -
 * docs/FLOWS.md), `settings` and `tiers` on every request,
 * never from a copy in the frontend. That is the whole point of the page - not
 * documentation of what we intended, but a window on the values the state
 * machine is actually using. ADMIN.md, "Configuration".
 *
 * Read-only: Jeel's decision, 2026-09-23. Changes go through a numbered
 * migration and a PR. There is no writer here and there should not be one.
 */

import { loadFlow } from './flows';
import { pool } from './pool';
import { NAME_FALLBACK, SEGMENT_LIMIT } from '../core/messages';

export interface ConfiguredMessage {
  /** Stable for the page's list: `q1`, `q1_1`, `clarify_q1`, `review`, `missed_call`. */
  key: string;
  /** What the page calls it: "Question 1", "After Q1 · Yes". */
  name: string;
  /** When a lead gets it: "The opener", "Unclear answer to Q2". */
  when: string;
  /** The text as the lead receives it - a choice's reply and the next question are one text. */
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
      /** The question's order in the flow. */
      question: number;
      /** 'q1', 'offers'. */
      key: string;
      /** What the screens call it: 'Next step'. */
      heading: string;
      choices: { choice: string; label: string | null; points: number }[];
    }[];
    /** Response + completion + the best answer to each question. */
    maxScore: number;
  };
  /** The flow new leads get, which is what this page describes. Null when none is active. */
  flow: { key: string; name: string } | null;
  tiers: { name: string; minScore: number; maxScore: number }[];
  /** Values the state machine reads that are not scoring or copy. */
  settings: { expiryDays: number; maxInvalidBeforeReview: number; segmentLimit: number };
  /** The longest first name on file, which drives worstCaseLength. */
  longestFirstName: string;
  /**
   * True when no name on file is longer than the word used for a lead with no
   * name ("there"), so that is what longestFirstName holds. The page words its
   * note differently then, rather than showing "there" as if it were a name.
   */
  longestNameIsFallback: boolean;
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
  const [settingsRows, activeFlow, tierRows, name] = await Promise.all([
    pool.query(`SELECT key, value FROM settings`),
    pool.query(`SELECT id, key, name FROM flows WHERE is_active`),
    pool.query(`SELECT name, min_score, max_score FROM tiers ORDER BY sort_order`),
    longestFirstName(),
  ]);

  const settings = new Map<string, string>(settingsRows.rows.map((r) => [r.key, r.value]));
  // The page describes the flow new leads get - docs/FLOWS.md.
  const flowRow = activeFlow.rows[0] ?? null;
  const flow = flowRow ? await loadFlow(pool, flowRow.id) : null;

  const message = (key: string, title: string, when: string, body: string): ConfiguredMessage => {
    const personalised = body.includes('{first_name}');
    const worstCaseLength = personalised ? body.replace(/\{first_name\}/g, name).length : body.length;
    return {
      key,
      name: title,
      when,
      body,
      length: body.length,
      worstCaseLength,
      segments: segmentsFor(worstCaseLength),
      costsExtraSegment: worstCaseLength > SEGMENT_LIMIT,
      personalised,
    };
  };

  // Every text a lead can receive, as it is sent, in the order they meet them:
  // the first question, then for each choice its reply joined to whatever
  // question follows, then the unclear replies, and the two outside the flow.
  const messages: ConfiguredMessage[] = [];
  if (flow) {
    const questions = [...flow.questions].sort((a, b) => a.position - b.position);
    const q = (id: number | null) => questions.find((x) => x.id === id);
    // "Q2" for a numbered question; one off the main line goes by its
    // heading, "Offers".
    const short = (x: { key: string; heading: string }) =>
      /^q\d+$/.test(x.key) ? x.key.toUpperCase() : x.heading;

    const first = questions[0];
    if (first) messages.push(message(first.key, `Question ${first.position}`, 'The opener', first.body));

    for (const question of questions) {
      for (const choice of question.choices) {
        const next = q(choice.nextQuestionId);
        const body = [choice.reply, next?.body].filter(Boolean).join(' ');
        if (!body) continue;
        messages.push(
          message(
            `${question.key}_${choice.choice}`,
            `After ${short(question)} · ${choice.label}`,
            next ? `Then ${short(next)}` : 'Ends the questions',
            body
          )
        );
      }
    }
    for (const question of questions) {
      messages.push(
        message(`clarify_${question.key}`, `Unclear · ${short(question)}`, 'A reply that is not one of the choices', question.clarifyBody)
      );
    }
    messages.push(message('review', 'Review', 'Second unclear reply', flow.reviewBody));
  }
  const missedCall = settings.get('message_missed_call');
  if (missedCall) {
    messages.push(message('missed_call', 'Missed call', 'A call to us nobody answered', missedCall));
  }

  const awards = flow
    ? [
        { code: 'responded', label: 'Responded at all', points: flow.respondedPoints },
        { code: 'completed', label: 'Completed the questions', points: flow.completedPoints },
      ]
    : [];

  const questions = flow
    ? [...flow.questions]
        .sort((a, b) => a.position - b.position)
        .map((question) => ({
          question: question.position,
          key: question.key,
          heading: question.heading,
          choices: question.choices.map((c) => ({ choice: c.choice, label: c.label, points: c.points })),
        }))
    : [];

  // What a lead who answers everything as well as possible can reach: the
  // awards plus the best answer to each question. A flow with a branch cannot
  // reach every question in one conversation, so this is an upper bound; for
  // the antibiotics flow it is exact, since the branch's choices earn nothing.
  const bestPerQuestion = questions.reduce(
    (total, question) => total + Math.max(0, ...question.choices.map((c) => c.points)),
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
    flow: flowRow ? { key: flowRow.key, name: flowRow.name } : null,
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
    longestNameIsFallback: name === NAME_FALLBACK,
  };
}
