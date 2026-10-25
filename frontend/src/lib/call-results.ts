/**
 * How the robot's call ended, in words - one wording for every screen that
 * says it: the timeline and the conversation ("Automated call · voicemail
 * left", T21) and Admin > Leads' Call column and its filter (T23). Pure.
 *
 * Mirrors `CallResult` in backend/src/core/call-script.ts. "Nobody took it"
 * rather than "nobody free": the lead also reached nobody when people were
 * free and let it ring out, or when they hung up while they waited.
 */
export const CALL_RESULT_WORDS: Record<string, string> = {
  transferred: 'said yes · taken',
  transfer_missed: 'said yes · nobody took it',
  link_sent: 'link sent',
  not_interested: 'not interested',
  opted_out: 'opted out',
  no_response: 'no response',
  voicemail_left: 'voicemail left',
  hung_up: 'hung up',
  unanswered: 'no answer',
};

/**
 * The Call column's words for a lead's robot call (`LeadCall` in
 * backend/src/db/leads.ts): its result, or `calling` while it has none, or
 * `unknown` when it has none an hour on - its end never reached us.
 */
export function leadCallText(call: string): string {
  if (call === 'calling') return 'Calling now';
  if (call === 'unknown') return 'No result';
  const words = CALL_RESULT_WORDS[call] ?? call.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The Call filter's choices, in the order a call goes: not called, under way,
 * a "yes", the other answers, then the calls nobody answered. '' is every
 * lead. The server takes exactly these (`?call=`, api/admin/leads.ts).
 */
const CALL_FILTER_KEYS = [
  'none',
  'calling',
  'transferred',
  'transfer_missed',
  'link_sent',
  'not_interested',
  'voicemail_left',
  'no_response',
  'hung_up',
  'unanswered',
  'opted_out',
  'unknown',
] as const;

export const CALL_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All calls' },
  ...CALL_FILTER_KEYS.map((key) => ({ key, label: key === 'none' ? 'Not called' : leadCallText(key) })),
];
