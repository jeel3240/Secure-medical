/**
 * What keeps this browser from taking a call - T9, AUTO-CALLS.md "Who is
 * free". `lib/calling.ts` tells the server; this is the part it reads.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function fresh() {
  vi.resetModules();
  return import('./presence');
}

let presence: Awaited<ReturnType<typeof fresh>>;
beforeEach(async () => {
  presence = await fresh();
});

describe('busy', () => {
  it('free until something says otherwise', () => {
    expect(presence.isBrowserBusy()).toBe(false);
  });

  it('busy while any one thing is, free only when the last of them is done', () => {
    presence.setBusy('lead-call', true);
    presence.setBusy('incoming-call', true);
    presence.setBusy('lead-call', false);
    expect(presence.isBrowserBusy()).toBe(true);
    presence.setBusy('incoming-call', false);
    expect(presence.isBrowserBusy()).toBe(false);
  });

  it('the listeners hear when the whole changes, and only then', () => {
    const heard = vi.fn();
    const stop = presence.onBusyChange(heard);
    presence.setBusy('lead-call', true);
    presence.setBusy('incoming-call', true); // already busy: not news
    presence.setBusy('lead-call', true); // said twice: not news
    expect(heard).toHaveBeenCalledTimes(1);
    presence.setBusy('lead-call', false);
    presence.setBusy('incoming-call', false);
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    presence.setBusy('lead-call', true);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('useBusyWhile', () => {
  it('follows the component: busy while active, free when not, and free once it is gone', () => {
    const { rerender, unmount } = renderHook(({ active }) => presence.useBusyWhile('lead-call', active), {
      initialProps: { active: false },
    });
    expect(presence.isBrowserBusy()).toBe(false);
    rerender({ active: true });
    expect(presence.isBrowserBusy()).toBe(true);
    rerender({ active: false });
    expect(presence.isBrowserBusy()).toBe(false);

    rerender({ active: true });
    unmount();
    expect(presence.isBrowserBusy()).toBe(false);
  });
});
