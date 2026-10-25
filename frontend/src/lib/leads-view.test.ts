import { describe, expect, it } from 'vitest';
import { DEFAULT_LEADS_VIEW, readLeadsView, writeLeadsView } from './leads-view';

const ALLOWED = { statuses: ['all', 'answering', 'ready'], sinces: ['all', '7d'], calls: ['', 'none', 'voicemail_left'] };
const read = (query: string) => readLeadsView(new URLSearchParams(query), ALLOWED);

describe('the Admin > Leads view, kept in the address', () => {
  it('the plain address is every lead, page one', () => {
    expect(read('')).toEqual(DEFAULT_LEADS_VIEW);
    expect(writeLeadsView(DEFAULT_LEADS_VIEW).toString()).toBe('');
  });

  it('survives a round trip - which is what coming Back to the list is', () => {
    const view = { status: 'answering', since: '7d', source: 'API', call: 'voicemail_left', q: 'eldon', page: 3 };
    expect(read(writeLeadsView(view).toString())).toEqual(view);
  });

  it('writes only what differs from the default', () => {
    expect(writeLeadsView({ ...DEFAULT_LEADS_VIEW, status: 'answering' }).toString()).toBe('status=answering');
    expect(writeLeadsView({ ...DEFAULT_LEADS_VIEW, page: 2 }).toString()).toBe('page=2');
    expect(writeLeadsView({ ...DEFAULT_LEADS_VIEW, call: 'none' }).toString()).toBe('call=none');
  });

  it('reads anything it does not recognise as the default, so it never reaches the server', () => {
    expect(read('status=nonsense&since=forever&call=voicemail')).toEqual(DEFAULT_LEADS_VIEW);
    expect(read('page=0').page).toBe(1);
    expect(read('page=2.5').page).toBe(1);
    expect(read('page=abc').page).toBe(1);
    expect(read('page=1e30').page).toBe(1);
  });

  it('trims the search', () => {
    expect(read('q=%20eldon%20').q).toBe('eldon');
  });
});
