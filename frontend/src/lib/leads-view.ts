/**
 * What Admin > Leads is showing - the tab, the filters, the search, the page -
 * read from and written to the page's address. Pure.
 *
 * It lived in the page's memory until 2026-10-11, so it was gone the moment
 * the page was: on the Answering tab, open a lead, come back - and the list
 * was on All again, page one, every time. In the address, Back returns to the
 * same list, and a link to a view can be sent to someone.
 *
 * A default is left out of the address, so the plain page stays
 * `/admin/leads`. Anything unrecognised reads as its default rather than
 * reaching the server: a hand-edited `?status=nonsense` shows All.
 */

export interface LeadsView {
  status: string;
  since: string;
  /** '' is every source. */
  source: string;
  /** The Call filter (T23): '' is every lead. */
  call: string;
  /** The search as sent to the server - trimmed. */
  q: string;
  page: number;
}

export const DEFAULT_LEADS_VIEW: LeadsView = { status: 'all', since: 'all', source: '', call: '', q: '', page: 1 };

export function readLeadsView(
  params: URLSearchParams,
  allowed: { statuses: readonly string[]; sinces: readonly string[]; calls: readonly string[] }
): LeadsView {
  const pick = (name: string, options: readonly string[], fallback: string): string => {
    const value = params.get(name);
    return value !== null && options.includes(value) ? value : fallback;
  };
  const page = Number(params.get('page'));

  return {
    status: pick('status', allowed.statuses, DEFAULT_LEADS_VIEW.status),
    since: pick('since', allowed.sinces, DEFAULT_LEADS_VIEW.since),
    source: params.get('source') ?? '',
    call: pick('call', allowed.calls, DEFAULT_LEADS_VIEW.call),
    q: (params.get('q') ?? '').trim(),
    // The server refuses a page past 100,000; so does this.
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}

export function writeLeadsView(view: LeadsView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.status !== DEFAULT_LEADS_VIEW.status) params.set('status', view.status);
  if (view.since !== DEFAULT_LEADS_VIEW.since) params.set('since', view.since);
  if (view.source) params.set('source', view.source);
  if (view.call) params.set('call', view.call);
  if (view.q) params.set('q', view.q);
  if (view.page > 1) params.set('page', String(view.page));
  return params;
}
