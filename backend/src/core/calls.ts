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

/** What a finished call is recorded as, in `calls.outcome`. */
export const CALL_OUTCOMES = ['answered', 'no_answer', 'busy', 'failed', 'canceled'] as const;
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
 * Why a call was not placed. The screen stops all of these before the call
 * starts; the voice webhook checks again because the screen is a courtesy and
 * the server is the lock - the same split as every other write on a lead.
 */
export type CallRefusal = 'not_found' | 'not_holder' | 'blocked' | 'bad_request';

/** Spoken to the agent in the browser, then the call ends. Short: they are listening, not reading. */
export const REFUSAL_SPEECH: Record<CallRefusal, string> = {
  not_found: 'This lead could not be found. The call was not placed.',
  not_holder: 'Pick up this lead before calling it. The call was not placed.',
  blocked: 'This number is on the do not call list. The call was not placed.',
  bad_request: 'The call could not be placed.',
};
