/**
 * Browser calling's rules, pure - Phase 4, TWILIO.md.
 *
 * No database and no Twilio here: who a browser is, what a finished call is
 * recorded as, and what an agent hears when a call is refused. The routes and
 * the SQL call these.
 */

/**
 * The browser's identity inside Twilio. It is written into the signed access
 * token we mint, so when Twilio later sends `From: client:agent-21` to our voice
 * webhook - itself signed - the agent id in it can be trusted.
 */
export function identityFor(userId: number): string {
  return `agent-${userId}`;
}

/** `client:agent-21` (as Twilio sends it) or `agent-21` -> 21. Anything else -> null. */
export function agentIdFromIdentity(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = /^(?:client:)?agent-([1-9]\d*)$/.exec(raw);
  return match ? Number(match[1]) : null;
}

/**
 * What a finished call is recorded as, in `calls.outcome`. `missed` is an
 * incoming call nobody answered, whatever the reason - the agent was away,
 * declined, was not signed in, or the lead hung up first. For the lead and for
 * the agent who has to ring back, those are all the same thing.
 *
 * `voicemail` is a call we placed that was picked up by a machine, not a
 * person - `answeredBy`, below. Twilio never reports it as an ending; it
 * reports `completed`, and the detection verdict is what turns `answered`
 * into `voicemail`.
 */
export const CALL_OUTCOMES = ['answered', 'voicemail', 'no_answer', 'busy', 'failed', 'canceled', 'missed'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/**
 * The lead's leg of the call, as Twilio reports it when it ends. `completed`
 * means it was answered and then hung up, by either side. Statuses Twilio sends
 * along the way (`ringing`, `in-progress`) are not endings and map to null.
 */
const OUTCOME_FOR_STATUS: Record<string, CallOutcome> = {
  completed: 'answered',
  'no-answer': 'no_answer',
  busy: 'busy',
  failed: 'failed',
  canceled: 'canceled',
};

export function outcomeForStatus(status: unknown): CallOutcome | null {
  return typeof status === 'string' ? (OUTCOME_FOR_STATUS[status] ?? null) : null;
}

/** Seconds of conversation. Only an answered call has any; Twilio's value is trusted no further. */
export function talkSeconds(outcome: CallOutcome, rawDuration: unknown): number {
  if (outcome !== 'answered') return 0;
  const seconds = Number(rawDuration);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : 0;
}

/**
 * Who picked up a call we placed, from Twilio's answering machine detection -
 * approved 2026-10-02. Twilio's values are finer than we need: every
 * `machine_*` is a machine. `unknown` is Twilio not being sure, and is kept as
 * that rather than guessed either way.
 */
export const ANSWERED_BY = ['human', 'machine', 'fax', 'unknown'] as const;
export type AnsweredBy = (typeof ANSWERED_BY)[number];

export function answeredByFor(raw: unknown): AnsweredBy | null {
  if (typeof raw !== 'string') return null;
  if (raw.startsWith('machine')) return 'machine';
  return (ANSWERED_BY as readonly string[]).includes(raw) ? (raw as AnsweredBy) : null;
}

/**
 * True when nobody was there to talk to. A fax line counts: it picked up, and
 * it is not the lead.
 */
export function tookByMachine(answeredBy: AnsweredBy | null): boolean {
  return answeredBy === 'machine' || answeredBy === 'fax';
}

/**
 * Why a call was not placed. The screen stops all of these before the call
 * starts; the voice webhook checks again because the screen is a courtesy and
 * the server is the lock - the same split as every other write on a lead.
 */
export type CallRefusal = 'not_found' | 'not_holder' | 'blocked' | 'bad_request';

/**
 * How long an incoming call rings the agent before it is a missed call. Long
 * enough to finish a sentence and click; short enough that the lead is not
 * left listening to ringing.
 */
export const INCOMING_RING_SECONDS = 20;

/** Said to a lead whose call nobody answered. A text saying the same follows - `message_missed_call`. */
export const MISSED_CALL_SPEECH =
  'Thank you for calling eDrugstore. Our team member is not available right now, and will call you back shortly. Goodbye.';

/**
 * Said to the lead before they are connected, on every recorded call - the
 * client's wording, 2026-10-05. Calls are recorded for their transcripts
 * (TWILIO.md, "Recordings and transcripts"), and some US states require
 * everyone on a call to be told. Until then no notice was played, by decision.
 */
export const RECORDING_NOTICE =
  'This call may be recorded and transcribed for quality, training, and service purposes. By continuing, you consent to the recording and transcription.';

/** Spoken to the agent in the browser, then the call ends. Short: they are listening, not reading. */
export const REFUSAL_SPEECH: Record<CallRefusal, string> = {
  not_found: 'This lead could not be found. The call was not placed.',
  not_holder: 'Pick up this lead before calling it. The call was not placed.',
  blocked: 'This number is on the do not call list. The call was not placed.',
  bad_request: 'The call could not be placed.',
};
