import { afterEach, describe, expect, it, vi } from 'vitest';
import { askToNotify, notifyIncomingCall } from './call-notification';

function stubNotification(permission: NotificationPermission) {
  const shown: { title: string; options: NotificationOptions; close: ReturnType<typeof vi.fn> }[] = [];
  const requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');
  const Fake = Object.assign(
    vi.fn((title: string, options: NotificationOptions) => {
      const notice = { title, options, close: vi.fn(), onclick: null };
      shown.push(notice);
      return notice;
    }),
    { permission, requestPermission }
  );
  vi.stubGlobal('Notification', Fake);
  return { Fake, shown };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a desktop notification for an incoming call', () => {
  it('says who is calling, and goes when the ring is over', () => {
    const { shown } = stubNotification('granted');
    const close = notifyIncomingCall('Priya S.', '(555) 010-0016');
    expect(shown[0].title).toBe('Incoming call · Priya S.');
    expect(shown[0].options).toMatchObject({ body: '(555) 010-0016', tag: 'incoming-call', requireInteraction: true });
    close();
    expect(shown[0].close).toHaveBeenCalled();
  });

  it('shows nothing without permission, or where notifications do not exist', () => {
    const { shown } = stubNotification('denied');
    expect(() => notifyIncomingCall('Priya S.', '')()).not.toThrow();
    expect(shown).toHaveLength(0);
    vi.stubGlobal('Notification', undefined);
    expect(() => notifyIncomingCall('Priya S.', '')()).not.toThrow();
  });

  it('asks for permission on the first click, once', () => {
    const { Fake } = stubNotification('default');
    askToNotify();
    expect(Fake.requestPermission).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('pointerdown'));
    expect(Fake.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('does not ask again once the agent has answered', () => {
    const { Fake } = stubNotification('denied');
    askToNotify();
    window.dispatchEvent(new Event('pointerdown'));
    expect(Fake.requestPermission).not.toHaveBeenCalled();
  });
});
