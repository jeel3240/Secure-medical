import type { DncState } from '../api/admin';

/**
 * What Admin > DNC list is showing - the state tab, the search, the page -
 * read from and written to the page's address. Pure. As `leads-view.ts` does
 * for Admin > Leads.
 *
 * It lived in the page's memory until review Q8, 2026-11-23: open a blocked
 * number's timeline, press Back, and the list was on All again, page one.
 *
 * A default is left out of the address, so the plain page stays `/admin/dnc`.
 * Anything unrecognised reads as its default rather than reaching the server.
 */

export interface DncView {
  state: DncState;
  /** The search as sent to the server - trimmed. */
  q: string;
  page: number;
}

export const DEFAULT_DNC_VIEW: DncView = { state: 'all', q: '', page: 1 };

const STATES: readonly DncState[] = ['all', 'blocked', 'released'];

export function readDncView(params: URLSearchParams): DncView {
  const state = params.get('state');
  const page = Number(params.get('page'));
  return {
    state: STATES.includes(state as DncState) ? (state as DncState) : DEFAULT_DNC_VIEW.state,
    q: (params.get('q') ?? '').trim(),
    // The server refuses a page past 100,000; so does this.
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}

export function writeDncView(view: DncView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.state !== DEFAULT_DNC_VIEW.state) params.set('state', view.state);
  if (view.q) params.set('q', view.q);
  if (view.page > 1) params.set('page', String(view.page));
  return params;
}
