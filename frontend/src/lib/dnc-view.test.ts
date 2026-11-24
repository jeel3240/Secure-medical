import { describe, expect, it } from 'vitest';
import { DEFAULT_DNC_VIEW, readDncView, writeDncView } from './dnc-view';

describe('the DNC list view in the address (review Q8)', () => {
  it('the plain page is the default view', () => {
    expect(readDncView(new URLSearchParams(''))).toEqual(DEFAULT_DNC_VIEW);
    expect(writeDncView(DEFAULT_DNC_VIEW).toString()).toBe('');
  });

  it('a view goes into the address and comes back the same', () => {
    const view = { state: 'released' as const, q: '602', page: 3 };
    expect(readDncView(writeDncView(view))).toEqual(view);
    expect(writeDncView(view).toString()).toBe('state=released&q=602&page=3');
  });

  it('anything unrecognised is its default, never sent to the server', () => {
    expect(readDncView(new URLSearchParams('state=nonsense&page=0'))).toEqual(DEFAULT_DNC_VIEW);
    expect(readDncView(new URLSearchParams('page=100001')).page).toBe(1);
    expect(readDncView(new URLSearchParams('page=2.5')).page).toBe(1);
    expect(readDncView(new URLSearchParams('q=%20%20dana%20')).q).toBe('dana');
  });
});
