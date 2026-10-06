import { api } from './client';

/** Mirrors LeadStatus in backend/src/db/leads.ts. */
export type LeadStatus =
  | 'awaiting_reply'
  | 'answering'
  | 'ready'
  /** Asked for special offers only: not a call to make. */
  | 'offers'
  /** Wants neither offers nor a rep. */
  | 'declined'
  | 'working'
  | 'closed'
  | 'needs_review'
  | 'opted_out'
  | 'expired';

export interface AdminLead {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  source: string | null;
  receivedAt: string | null;
  status: LeadStatus | null;
  /**
   * The question the lead is on now or stopped at, as the server names it -
   * "Q2", "Q1-a" - or `done` once the questions are finished.
   */
  step: string | null;
  score: number | null;
  tier: string | null;
  lastActivityAt: string | null;
  lastActivityDirection: 'inbound' | 'outbound' | null;
}

export interface AdminLeadsResponse {
  leads: AdminLead[];
  total: number;
  counts: Record<string, number>;
  page: number;
  pageSize: number;
  sources: string[];
  poll: { at: string | null; intervalSeconds: number };
}

export interface AdminLeadsQuery {
  status?: string;
  source?: string[];
  since?: string;
  q?: string;
  page?: number;
}

export async function listAdminLeads(query: AdminLeadsQuery): Promise<AdminLeadsResponse> {
  const params: Record<string, string | number> = {};
  if (query.status && query.status !== 'all') params.status = query.status;
  if (query.source?.length) params.source = query.source.join(',');
  if (query.since && query.since !== 'all') params.since = query.since;
  if (query.q) params.q = query.q;
  if (query.page && query.page > 1) params.page = query.page;

  const { data } = await api.get<AdminLeadsResponse>('/admin/leads', { params });
  return data;
}

/** Mirrors QueueTag in backend/src/core/queue-tags.ts. */
export type QueueTagKind = 'working' | 'missed_call' | 'inbound_reply' | 'callback' | 'wants_call' | 'needs_review';

export interface QueueTag {
  kind: QueueTagKind;
  /** `working`: who holds it - the id to match on. */
  agentId?: number;
  /** `working`: who holds it - the name to show. `callback`: whose it is. */
  agentName?: string;
  /** `callback`: when it is due, ISO. */
  at?: string;
}

/** Mirrors QueueRow in backend/src/db/queue.ts. */
export interface QueueLead {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  source: string | null;
  receivedAt: string | null;
  score: number;
  tier: string | null;
  /**
   * What the lead answered, in their flow's order - as many as it asked and
   * they answered. The word is the one saved with the answer. FLOWS.md.
   */
  answers: { key: string; heading: string; label: string }[];
  conversationStatus: 'open' | 'completed' | 'review' | 'expired' | 'suppressed';
  /** `null` when there is nothing to say: the lead is waiting to be picked up. */
  tag: QueueTag | null;
}

export interface QueueResponse {
  leads: QueueLead[];
  /** Per tier plus `all`, ignoring the tier filter, so the pills keep their numbers. */
  counts: Record<string, number>;
  sources: string[];
  total: number;
  limit: number;
}

export interface QueueQuery {
  tier?: string[];
  source?: string[];
  since?: string;
  q?: string;
}

export async function listQueue(query: QueueQuery = {}): Promise<QueueResponse> {
  const params: Record<string, string> = {};
  if (query.tier?.length) params.tier = query.tier.join(',');
  if (query.source?.length) params.source = query.source.join(',');
  if (query.since && query.since !== 'all') params.since = query.since;
  if (query.q) params.q = query.q;

  const { data } = await api.get<QueueResponse>('/leads', { params });
  return data;
}

/**
 * Claims a lead for the signed-in agent.
 *
 * Throws on 409 `already_claimed`, which is not an error in the usual sense -
 * someone was simply first. The caller reads `toApiError(err).code` and shows
 * the holder's name from the message.
 */
export async function claimLead(id: number): Promise<void> {
  await api.post(`/leads/${id}/claim`);
}

/** Releases your own claim. A superadmin may release anyone's. */
export async function releaseLead(id: number): Promise<void> {
  await api.post(`/leads/${id}/release`);
}
