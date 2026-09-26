import { api } from './client';

/**
 * The three read-only admin screens: Configuration, Overview and the DNC list.
 *
 * There are no writers here, deliberately - Jeel's decision of 2026-09-23.
 * Scoring, copy and the DNC list are changed through a numbered migration and a
 * PR, not from a screen. `ADMIN.md` has the reasoning.
 */

/** Mirrors ConfiguredMessage in backend/src/db/admin-config.ts. */
export interface ConfiguredMessage {
  key: string;
  body: string;
  length: number;
  /** Longest this can be once a name is substituted - what decides the segments. */
  worstCaseLength: number;
  segments: number;
  costsExtraSegment: boolean;
  personalised: boolean;
}

export interface AdminConfig {
  messages: ConfiguredMessage[];
  scoring: {
    awards: { code: string; label: string | null; points: number }[];
    questions: { question: number; choices: { choice: string; label: string | null; points: number }[] }[];
    maxScore: number;
  };
  tiers: { name: string; minScore: number; maxScore: number }[];
  settings: { expiryDays: number; maxInvalidBeforeReview: number; segmentLimit: number };
  /** The longest first name on file, which drives worstCaseLength. */
  longestFirstName: string;
}

export async function getConfig(): Promise<AdminConfig> {
  const { data } = await api.get<AdminConfig>('/admin/config');
  return data;
}

export type OverviewPeriod = 'today' | '7d' | '30d';

/** Mirrors Overview in backend/src/db/admin-overview.ts. */
export interface Overview {
  period: OverviewPeriod;
  since: string;
  kpis: {
    leadsReceived: number;
    responded: number;
    respondedPct: number;
    completed: number;
    completedPct: number;
    hot: number;
    callsMade: number;
    reached: number;
    reachedPct: number;
    callbacksSet: number;
    dncAdded: number;
  };
  funnel: { stage: string; count: number }[];
  agents: {
    agentId: number;
    name: string;
    calls: number;
    reached: number;
    avgCallSeconds: number | null;
    dispositions: Record<string, number>;
    callbacksPending: number;
  }[];
  activity: {
    kind: 'disposition' | 'note' | 'callback' | 'agent_sms';
    at: string;
    agentName: string | null;
    leadId: number;
    leadName: string;
    detail: Record<string, unknown>;
  }[];
  /** False until Twilio lands: every call figure above is structurally zero. */
  callsBuilt: boolean;
}

export async function getOverview(period: OverviewPeriod): Promise<Overview> {
  const { data } = await api.get<Overview>('/admin/overview', { params: { period } });
  return data;
}

/** Mirrors DncRow in backend/src/db/admin-dnc.ts. */
export interface DncRow {
  phone: string;
  reason: string;
  addedAt: string;
  releasedAt: string | null;
  releasedReason: string | null;
  /** The live state, which is what the screen colours on. */
  blocked: boolean;
  /** Null when we hold no lead for the number, which the table allows. */
  lead: { id: number; name: string } | null;
}

export interface DncResult {
  rows: DncRow[];
  total: number;
  page: number;
  limit: number;
  counts: { all: number; blocked: number; released: number };
}

export type DncState = 'all' | 'blocked' | 'released';

export async function getDnc(query: { q?: string; page?: number; state?: DncState } = {}): Promise<DncResult> {
  const params: Record<string, string | number> = {};
  if (query.q) params.q = query.q;
  if (query.page && query.page > 1) params.page = query.page;
  if (query.state && query.state !== 'all') params.state = query.state;

  const { data } = await api.get<DncResult>('/admin/dnc', { params });
  return data;
}

/** Mirrors Health in backend/src/db/health.ts. */
export interface Health {
  status: 'ok' | 'degraded';
  checkedAt: string;
  checks: {
    name: string;
    status: 'ok' | 'degraded';
    message: string | null;
    detail: Record<string, unknown>;
  }[];
}

export async function getHealth(): Promise<Health> {
  const { data } = await api.get<Health>('/admin/health');
  return data;
}
