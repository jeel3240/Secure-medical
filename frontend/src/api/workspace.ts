import { api } from './client';

/**
 * The agent workspace, the lead timeline and My Callbacks.
 *
 * Every type here mirrors a backend one; the file name beside each says which,
 * so a change on the server has an obvious counterpart here.
 */

/** Mirrors AnswerChip in backend/src/core/score-breakdown.ts. */
export interface AnswerChip {
  question: number;
  heading: string;
  /** Null when the lead has not answered that question yet. */
  answer: string | null;
}

/** Mirrors BreakdownLine in backend/src/core/score-breakdown.ts. */
export interface BreakdownLine {
  code: string;
  label: string;
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
    score: number;
    tier: string | null;
    expiresAt: string | null;
    /** Set once an agent takes over - STATE-MACHINE.md 2b. */
    agentTookOverAt: string | null;
  } | null;
  chips: AnswerChip[];
  breakdown: BreakdownLine[];
  claimedBy: { id: number; name: string; at: string } | null;
  flags: {
    /** A live dnc_list row: blocks every action, not just SMS. */
    dnc: boolean;
    needsReview: boolean;
    unread: boolean;
    expired: boolean;
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
  | 'disposition';

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

export interface Note {
  id: number;
  leadId: number;
  agentId: number;
  agentName: string | null;
  body: string;
  createdAt: string;
}

export async function addNote(id: number, body: string): Promise<Note> {
  const { data } = await api.post<{ note: Note }>(`/leads/${id}/notes`, { body });
  return data.note;
}

/** The seven from core/dispositions.ts, in the order the control shows them. */
export const DISPOSITIONS = [
  'interested',
  'callback_set',
  'no_answer',
  'voicemail',
  'not_interested',
  'wrong_number',
  'dnc',
] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
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

export interface Callback {
  id: number;
  leadId: number;
  agentId: number;
  agentName: string | null;
  scheduledAt: string;
  doneAt: string | null;
}

export interface CallbackRow extends Callback {
  lead: {
    id: number;
    phone: string;
    firstName: string | null;
    lastName: string | null;
    score: number | null;
    tier: string | null;
  };
  latestNote: string | null;
}

export type CallbackWhen = 'today' | 'upcoming' | 'overdue' | 'all';

export interface CallbackList {
  callbacks: CallbackRow[];
  /** Every tab's count, whichever tab was asked for. */
  counts: Record<CallbackWhen, number>;
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
  agentId?: number
): Promise<CallbackList> {
  const params: Record<string, string | number> = { when };
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
