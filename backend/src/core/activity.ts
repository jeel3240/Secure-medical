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
  // The do-not-call list. Re-blocking a number overwrites its row.
  'dnc.blocked',
  'dnc.released',
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
