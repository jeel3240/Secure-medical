/**
 * Everything the activity log records - docs/AUDIT.md.
 *
 * The company keeps data as proof (Jeel, 2026-10-01), so every action a person
 * or the system takes is one row in `activity_log`, written with the action
 * itself. This is the list of actions; a new one is added here first, so the
 * log's vocabulary stays in one place and a typo is a compile error.
 *
 * Named `area.verb`. The verb is past tense: a row says what happened.
 */
export const ACTIVITY_ACTIONS = [
  // A lead being worked.
  'lead.picked_up',
  'lead.released',
  'reply.read',
  'note.added',
  'outcome.set',
  // Callbacks. A reschedule and a reopen overwrite the row; the log keeps both sides.
  'callback.booked',
  // A call back Seri booked, taken by the first agent to pick the lead up (A16).
  'callback.taken',
  'callback.rescheduled',
  'callback.done',
  'callback.reopened',
  // An agent's own text.
  'sms.sent',
  'sms.failed',
  'sms.blocked',
  // Calls. A refused call leaves no `calls` row, so this is its only record;
  // so does an incoming call from a number we hold no lead for.
  'call.started',
  'call.ended',
  'call.refused',
  'call.incoming',
  'call.missed',
  /**
   * A person took a lead's call that rang everyone free - `detail.callId`
   * (T19, AUTO-CALLS.md "A lead calling back"). Once per call: the first to
   * accept; the call is theirs from then.
   */
  'call.taken',
  /**
   * A person took an automated call's transfer - `detail.callId`, and
   * `tookOverFrom` when the lead was someone else's (T15a, AUTO-CALLS.md).
   * Written once per call, whoever held the lead before.
   */
  'call.transferred',
  /**
   * A "yes" nobody could take went on hold, waiting for someone on a call -
   * `detail.callId` (T16, AUTO-CALLS.md "The hold line"). The system's doing.
   */
  'call.held',
  /** Twilio's verdict on who picked up a call we placed - a person or a machine. */
  'call.answered_by',
  /** A call's recording is in, and its transcript is in line. */
  'call.recorded',
  'call.transcribed',
  'call.transcript_failed',
  // The do-not-call list. Re-blocking a number overwrites its row.
  'dnc.blocked',
  'dnc.released',
  /**
   * The "Taking calls" switch went on or off - `detail.on`, and `detail.why`:
   * `by_hand`, `sign_in` or `sign_out` (T10, AUTO-CALLS.md "Who is free"), or
   * `missed_transfer` - the server turned it off after a ring was let run out,
   * with `detail.callId` (T15c).
   */
  'calls.availability_changed',
  /**
   * The worker started placing automated calls after they were off - or for
   * the first time: `detail.since`, the new start, and `previousSince`, the
   * one it replaced (T20 review, AUTO-CALLS.md "When a lead is called"). The
   * system's doing - someone set `AUTO_CALLS=on`.
   */
  'auto_calls.switched_on',
  /**
   * Seri, the AI agent, switched on or off - `detail.from`, what
   * `settings.ai_agent` said before (null when it was never set), `to`, and
   * `via`: `command` - run on the server, so no actor - or `website`, the
   * superadmin who clicked on Admin > Configuration (2026-11-24). AI-AGENT.md
   * section 7.
   */
  'ai_agent.switched',
  /**
   * Seri took an automated call: the relay's `setup` - `detail.callId` and
   * `knowledgeVersion`, the version of her knowledge files (A10, AI-AGENT.md
   * section 9). The system's doing. Once per call.
   */
  'ai_agent.started',
  /**
   * How Seri's part of a call ended - `detail.callId`, `action` (one of her
   * five, or `fallback`), and for `end_call` its `reason` (A11, AI-AGENT.md
   * section 9). The system's doing. Once per call, with `calls.ai_ended_with`.
   */
  'ai_agent.ended',
  /**
   * The line to our server dropped on a call of Seri's - a restart of the api,
   * or the network - and Twilio opened the relay again: the call was picked
   * back up where it was - `detail.callId`, `attempt` (Twilio's count on this
   * call, null when it gave none), and `ended`: she had already chosen her
   * action, which was then carried out (AI-AGENT.md section 2, "When the line
   * drops"). The system's doing. Up to five per call.
   */
  'ai_agent.reconnected',
  /**
   * A local test script changed a test lead's rows - never on production, where
   * the scripts refuse to run. `detail.what`: `ask_again` (dev-ask-again: the
   * open conversation expired and a new one started, `expired` its ids),
   * `number_moved` (dev-auto-call --again: this lead's number given to a fresh
   * test lead, `phone` the number it had, `now` the one it has, `freshLeadId`),
   * or `conversation_given` (dev-auto-call: a lead with none given one, nothing
   * texted). Run from a laptop, so no actor. Review Q9, 2026-11-23: these wrote
   * with no record, and the number move overwrote the only record of the
   * number a lead had.
   */
  'dev.test_reset',
  // Sign-in.
  'auth.signed_in',
  'auth.sign_in_failed',
  'auth.signed_out',
  'auth.password_changed',
  // Agent accounts, changed by a superadmin.
  'user.created',
  'user.updated',
  'user.password_reset',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEntry {
  action: ActivityAction;
  /** Who did it. Null when the system did - the poller, a webhook, Twilio. */
  actorId: number | null;
  leadId?: number | null;
  /** The user it was done to, when that is not the actor. */
  subjectUserId?: number | null;
  /** What would otherwise be lost. Never a password, a token or a message body. */
  detail?: Record<string, unknown>;
}
