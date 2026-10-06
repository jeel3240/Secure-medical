import { api, viewerTimeZone } from './client';

/**
 * The agent workspace, the lead timeline and My Callbacks.
 *
 * Every type here mirrors a backend one; the file name beside each says which,
 * so a change on the server has an obvious counterpart here.
 */

/** Mirrors AnswerChip in backend/src/core/score-breakdown.ts. */
export interface AnswerChip {
  /** The question's order in the lead's flow. */
  question: number;
  /** 'q1', 'offers'. */
  key: string;
  heading: string;
  /** One chip per question answered, so there is always an answer. */
  answer: string;
  /** The raw `1`/`2`/`3` the lead sent, for labelling the conversation view. */
  choice: string;
}

/** Mirrors BreakdownLine in backend/src/core/score-breakdown.ts. */
export interface BreakdownLine {
  code: string;
  label: string;
  /** For an answer, what was asked: "Requested info". */
  heading?: string;
  points: number;
}

/** Mirrors LeadDetail in backend/src/db/lead-detail.ts. */
export interface LeadDetail {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  source: string | null;
  receivedAt: string | null;
  conversation: {
    id: number;
    status: string;
    step: number | null;
    /** The question the lead is on or stopped at, as the screens say it: "Q2", "Offers". */
    question: string | null;
    score: number;
    tier: string | null;
    expiresAt: string | null;
    /** Set once an agent takes over - STATE-MACHINE.md 2b. */
    agentTookOverAt: string | null;
    /** Which flow the lead is in: 'antibiotics'. FLOWS.md. */
    flow: string | null;
    /** How the flow ended: completed, offers, wants_contact, declined - or null. */
    endOutcome: string | null;
  } | null;
  chips: AnswerChip[];
  breakdown: BreakdownLine[];
  claimedBy: { id: number; name: string; at: string } | null;
  /** Set while the lead is closed: who closed it and when. */
  closed: { by: string | null; at: string } | null;
  flags: {
    /** A live dnc_list row: blocks every action, not just SMS. */
    dnc: boolean;
    needsReview: boolean;
    unread: boolean;
    expired: boolean;
    /** They rang us, nobody answered, and nobody has called or texted back. */
    missedCall: boolean;
  };
}

export async function getLead(id: number): Promise<LeadDetail> {
  const { data } = await api.get<{ lead: LeadDetail }>(`/leads/${id}`);
  return data.lead;
}

/** Mirrors TimelineKind in backend/src/db/timeline.ts. */
export type TimelineKind =
  | 'system'
  | 'sms'
  | 'inbound'
  | 'agent_sms'
  | 'call'
  | 'note'
  | 'callback'
  | 'disposition'
  /** From the activity log: a pick-up, a release, a moved callback - AUDIT.md. */
  | 'activity';

export interface TimelineEntry {
  kind: TimelineKind;
  at: string;
  /** The agent, where one acted. Null for automated and inbound entries. */
  author: string | null;
  /** Free-form per kind - the screen knows what to read. */
  detail: Record<string, unknown>;
}

export async function getTimeline(id: number): Promise<TimelineEntry[]> {
  const { data } = await api.get<{ entries: TimelineEntry[] }>(`/leads/${id}/timeline`);
  return data.entries;
}

/** Clears has_unread_inbound. Idempotent; 204. */
export async function markRead(id: number): Promise<void> {
  await api.post(`/leads/${id}/read`);
}

/** Mirrors Note in backend/src/db/notes.ts - `author`, not an agent id. */
export interface Note {
  id: number;
  leadId: number;
  author: string;
  body: string;
  createdAt: string;
}

export async function addNote(id: number, body: string): Promise<Note> {
  const { data } = await api.post<{ note: Note }>(`/leads/${id}/notes`, { body });
  return data.note;
}

/** Mirrors core/dispositions.ts: the two an agent can record. */
export const DISPOSITIONS = ['closed', 'dnc'] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * Words for every value a timeline may hold - the two recorded now, and the
 * ones retired on 2026-09-28, which stay in old rows.
 */
export const DISPOSITION_LABEL: Record<string, string> = {
  closed: 'Closed',
  sold: 'Sold',
  interested: 'Interested',
  callback_set: 'Callback set',
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number',
  dnc: 'DNC',
};

export interface DispositionRow {
  id: number;
  leadId: number;
  agentId: number;
  agentName: string | null;
  value: Disposition;
  createdAt: string;
  /** True when this disposition blocked the number. Only ever for `dnc`. */
  blockedNumber: boolean;
  /** Saving an outcome lets go of the lead - both values do. */
  released: boolean;
}

/**
 * `dnc` needs `confirmDnc: true` or the API refuses it - the block is lifted
 * only by a START from the lead, so a mis-click must not be able to set it.
 */
export async function setDisposition(
  id: number,
  value: Disposition,
  confirmDnc = false
): Promise<DispositionRow> {
  const { data } = await api.post<{ disposition: DispositionRow }>(`/leads/${id}/dispositions`, {
    value,
    ...(value === 'dnc' ? { confirmDnc } : {}),
  });
  return data.disposition;
}

/** Mirrors Callback in backend/src/db/callbacks.ts. */
export interface Callback {
  id: number;
  leadId: number;
  agentId: number;
  agentName: string;
  scheduledAt: string;
  doneAt: string | null;
  /** `missed_call`: booked by the system because the lead rang and this agent did not pick up. */
  reason: 'booked' | 'missed_call';
}

/**
 * Mirrors CallbackListRow. The lead carries no id of its own - `leadId` on the
 * callback is the one to link with - and no score, only the tier.
 */
export interface CallbackRow extends Callback {
  lead: {
    phone: string;
    firstName: string | null;
    lastName: string | null;
    source: string | null;
    tier: string | null;
  };
  /** The most recent note on the lead, for the excerpt column. */
  latestNote: string | null;
  /** Who holds the lead right now, if anyone. */
  holder: { id: number; name: string } | null;
  /** A missed call's callback: how many calls it stands for, and when the latest was. */
  missedCalls: { count: number; lastAt: string } | null;
}

export type CallbackWhen = 'today' | 'upcoming' | 'overdue' | 'all';

export interface CallbackList {
  callbacks: CallbackRow[];
  /** Every tab's count, whichever tab was asked for. */
  counts: Record<string, number>;
}

export async function createCallback(
  id: number,
  scheduledAt: string,
  agentId?: number
): Promise<Callback> {
  const { data } = await api.post<{ callback: Callback }>(`/leads/${id}/callbacks`, {
    scheduledAt,
    ...(agentId ? { agentId } : {}),
  });
  return data.callback;
}

export async function listCallbacks(
  when: CallbackWhen = 'today',
  /** Another agent's id, or 'all' for everyone's - superadmin only. Omit for your own. */
  agentId?: number | 'all'
): Promise<CallbackList> {
  const params: Record<string, string | number> = { when, tz: viewerTimeZone() };
  if (agentId) params.agentId = agentId;
  const { data } = await api.get<CallbackList>('/callbacks', { params });
  return data;
}

export async function updateCallback(
  callbackId: number,
  changes: { scheduledAt?: string; done?: boolean }
): Promise<Callback> {
  const { data } = await api.patch<{ callback: Callback }>(`/callbacks/${callbackId}`, changes);
  return data.callback;
}

export interface AgentMessage {
  id: number;
  leadId: number;
  body: string;
  sentBy: number;
  agentName: string | null;
  eztMessageId: string | null;
  createdAt: string;
  /** True when this send is what stopped the automated questions. */
  tookOver: boolean;
}

/** One SMS segment. Longer costs a second segment on every send. */
export const SMS_LIMIT = 160;

export async function sendAgentSms(id: number, body: string): Promise<AgentMessage> {
  const { data } = await api.post<{ message: AgentMessage }>(`/leads/${id}/messages`, { body });
  return data.message;
}
