/**
 * Admin > Configuration: what we ask, and what each answer is worth.
 *
 * Read straight from the active flow (`flows`, `flow_questions`, `flow_choices` -
 * docs/FLOWS.md), `settings` and `tiers` on every request,
 * never from a copy in the frontend. That is the whole point of the page - not
 * documentation of what we intended, but a window on the values the state
 * machine is actually using. ADMIN.md, "Configuration".
 *
 * And since T24 the automated call's: its script (`call_scripts`, `call_steps`,
 * `call_choices` - AUTO-CALLS.md, "The script") and the settings a call reads,
 * each through the reader the robot itself uses (`db/call-script.ts`), so a
 * missing or malformed value shows as the value the robot falls back to.
 *
 * Read-only: Jeel's decision, 2026-09-23. Changes go through a numbered
 * migration and a PR. There is no writer here and there should not be one.
 */

import { loadFlow } from './flows';
import { RECORDING_NOTICE } from '../core/calls';
import type { CallScript } from '../core/call-script';
import { questionShort } from '../core/questions';
import { pool } from './pool';
import { NAME_FALLBACK, SEGMENT_LIMIT } from '../core/messages';
import {
  loadActiveCallScript,
  readCallHours,
  readHoldMaxSeconds,
  readMinConfidence,
  readOfferRingSeconds,
  readRingSeconds,
} from './call-script';

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

/** One thing the robot says - T24. Listed in the order a lead can hear them. */
export interface CallLine {
  /** Stable for the page's list: `q1`, `q1_1`, `repeat_q1`, `stop`, `voicemail`. */
  key: string;
  /** What the page calls it: "Q1 · Offer", "After Q1 · Yes", "Busy". */
  name: string;
  /** When it is said: "When the lead picks up", "Then Q2". */
  when: string;
  /** As written: `{callback_number}` and `{place}` are filled in on the call. */
  body: string;
  /** The key that picks it - a choice, and stop. Null for a line nobody picks. */
  press: string | null;
  /** What may be said for it, found as whole words in the sentence (`matchSpokenChoice`). */
  words: string[];
}

/**
 * The settings an automated call reads - T24, through the robot's own readers,
 * so these are the values it uses, fallbacks included.
 */
export interface CallSettings {
  /** `AUTO_CALLS=on` and calling set up: the robot is calling. */
  on: boolean;
  /** Minutes after midnight, in `timeZone`: from, and up to but not including. */
  startMinute: number;
  endMinute: number;
  timeZone: string;
  /** 'mon'..'sun', in the week's order. */
  days: string[];
  /** After the first text, for a lead who has not replied. */
  waitMinutes: number;
  /** How long a "yes" rings people. */
  ringSeconds: number;
  /** How long a lead on hold rings the person who came free. */
  offerRingSeconds: number;
  /** The hold line's safety stop. */
  holdMaxMinutes: number;
  /** A spoken answer heard less surely than this is asked again. */
  minConfidence: number;
  /** The number the voicemail asks them to call back - the calling number. Null with calling not set up. */
  callbackNumber: string | null;
}

/** What the page cannot read from the database: the api's own settings - `api/admin/config.ts`. */
export interface CallingContext {
  autoCalls: boolean;
  callbackNumber: string | null;
  /** Calls are recorded, so the recording notice is said before a person joins. */
  recorded: boolean;
}

const NO_CALLING: CallingContext = { autoCalls: false, callbackNumber: null, recorded: false };

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface AdminConfig {
  messages: ConfiguredMessage[];
  scoring: {
    awards: { code: string; label: string | null; points: number }[];
    questions: {
      /** The question's order in the flow. */
      question: number;
      /** 'q1', 'q1-a'. */
      key: string;
      /** What the screens call the question itself: 'Q3', 'Q1-a' - `core/questions.ts`. */
      short: string;
      /** What the screens call its answer: 'Next step'. */
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
  /** The automated call's active script, every line in order - null when none is active (T24). */
  callScript: { key: string; name: string; voice: string; lines: CallLine[] } | null;
  callSettings: CallSettings;
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

/**
 * Every line of the call script, in the order a lead can hear them: each
 * question, then each answer's reply and where it leads, then the question's
 * repeat line; then the lines every question shares, as the call goes on - no
 * response, stop, the recording notice, the hold line, the busy line - and the
 * voicemail, left instead of all of it.
 */
function callLines(script: CallScript, recorded: boolean): CallLine[] {
  const steps = [...script.steps].sort((a, b) => a.position - b.position);
  const short = questionShort;
  const line = (key: string, name: string, when: string, body: string, press: string | null = null, words: readonly string[] = []): CallLine => ({
    key,
    name,
    when,
    body,
    press,
    words: [...words],
  });
  const ENDING: Record<string, string> = {
    transfer: 'Then puts them through to a person',
    send_link: 'Then texts the link, and ends',
    declined: 'Then ends the call',
  };

  const lines: CallLine[] = [];
  for (const step of steps) {
    // Reached by the choice that leads to it; the first is asked on pick-up.
    const from = steps.flatMap((s) => s.choices.map((c) => ({ step: s, choice: c }))).find((x) => x.choice.nextStepId === step.id);
    const when =
      step === steps[0] ? 'When the lead picks up' : from ? `After ${short(from.step)} · ${from.choice.label}` : 'No answer leads here';
    lines.push(line(step.key, `${short(step)} · ${step.heading}`, when, step.body));
    for (const choice of step.choices) {
      const next = steps.find((s) => s.id === choice.nextStepId);
      lines.push(
        line(
          `${step.key}_${choice.key}`,
          `After ${short(step)} · ${choice.label}`,
          next ? `Then ${short(next)}` : (ENDING[choice.ending ?? ''] ?? 'Then ends the call'),
          choice.reply,
          choice.key,
          choice.words
        )
      );
    }
    lines.push(line(`repeat_${step.key}`, `Unclear · ${short(step)}`, 'Not understood, the first time', step.repeatBody));
  }

  lines.push(line('no_response', 'No response', 'Not understood twice - the call ends', script.noResponseBody));
  lines.push(line('stop', 'Stop', 'On any question - the number is blocked', script.optOutBody, '9', script.optOutWords));
  // Said before anyone joins - a ring, or the hold line - when calls are recorded (T15a).
  if (recorded) lines.push(line('notice', 'Recording notice', 'After a yes, before a person joins', RECORDING_NOTICE));
  lines.push(line('hold', 'Hold', 'A yes nobody took yet, while someone is on a call', script.holdBody));
  lines.push(line('hold_next', 'Next in line', 'On hold, first in line', script.holdNextBody));
  lines.push(line('hold_place', 'Place in line', 'On hold, further back', script.holdPlaceBody));
  lines.push(line('busy', 'Busy', 'A yes nobody took, and nobody coming - the call ends', script.busyBody));
  lines.push(line('voicemail', 'Voicemail', "A machine answered - left after its beep", script.voicemailBody));
  return lines;
}

/** The settings an automated call reads, as the robot reads them - fallbacks included. */
async function callSettings(calling: CallingContext): Promise<CallSettings> {
  const [hours, ringSeconds, offerRingSeconds, holdMaxSeconds, minConfidence] = await Promise.all([
    readCallHours(pool),
    readRingSeconds(pool),
    readOfferRingSeconds(pool),
    readHoldMaxSeconds(pool),
    readMinConfidence(pool),
  ]);
  return {
    on: calling.autoCalls,
    startMinute: hours.startMinute,
    endMinute: hours.endMinute,
    timeZone: hours.timeZone,
    days: WEEK.filter((d) => (hours.days as ReadonlySet<string>).has(d)),
    waitMinutes: hours.waitMinutes,
    ringSeconds,
    offerRingSeconds,
    holdMaxMinutes: holdMaxSeconds / 60,
    minConfidence,
    callbackNumber: calling.callbackNumber,
  };
}

/**
 * `calling` is what only the api knows - whether automated calls are on, the
 * calling number, whether calls are recorded. Without it: off, no number, not
 * recorded.
 */
export async function getAdminConfig(calling: CallingContext = NO_CALLING): Promise<AdminConfig> {
  const [settingsRows, activeFlow, tierRows, name, script, call] = await Promise.all([
    pool.query(`SELECT key, value FROM settings`),
    pool.query(`SELECT id, key, name FROM flows WHERE is_active`),
    pool.query(`SELECT name, min_score, max_score FROM tiers ORDER BY sort_order`),
    longestFirstName(),
    loadActiveCallScript(pool),
    callSettings(calling),
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
    const short = questionShort;

    const first = questions[0];
    // "Question 1": from the question's own name, not its position - positions go in tens.
    if (first) messages.push(message(first.key, short(first).replace(/^Q(?=\d)/, 'Question '), 'The opener', first.body));

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
  // A text too, so it is counted here with the others - T24, T14.
  if (script) {
    messages.push(message('call_link', 'Call · link', 'A yes to the link, on the automated call', script.linkText));
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
          short: questionShort(question),
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
    callScript: script
      ? { key: script.key, name: script.name, voice: script.voice, lines: callLines(script, calling.recorded) }
      : null,
    callSettings: call,
  };
}
