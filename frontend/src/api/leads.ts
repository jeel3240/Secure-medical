import { api } from './client';

export type LeadStatus =
  | 'awaiting_reply'
  | 'in_progress'
  | 'completed'
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
  stepReached: number | null;
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
