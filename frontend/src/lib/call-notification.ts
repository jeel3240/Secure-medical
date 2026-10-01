/**
 * A desktop notification for an incoming call - TWILIO.md, "Incoming calls".
 *
 * The second way an agent learns the phone is ringing, for when the first
 * cannot reach them: the browser is behind another window or minimised, or it
 * is still refusing to play sound because nobody has clicked on the page since
 * it loaded (`lib/ringtone.ts`). The operating system shows it, with its own
 * sound, whatever the browser is doing.
 *
 * It needs the agent's permission, which a browser only lets a page ask for on
 * a click - so it is asked for on the first click after signing in, once.
 * Refused, or unsupported, and everything here quietly does nothing.
 */

const supported = (): boolean => typeof Notification !== 'undefined';

/** Asks for permission on the first click, if it has never been answered. Returns how to stop waiting. */
export function askToNotify(): () => void {
  if (!supported() || Notification.permission !== 'default') return () => undefined;
  const ask = () => {
    window.removeEventListener('pointerdown', ask);
    void Notification.requestPermission().catch(() => undefined);
  };
  window.addEventListener('pointerdown', ask);
  return () => window.removeEventListener('pointerdown', ask);
}

/** Shows it until the returned function is called. Clicking it brings the app to the front. */
export function notifyIncomingCall(who: string, detail: string): () => void {
  if (!supported() || Notification.permission !== 'granted') return () => undefined;
  try {
    // One at a time: a second ring replaces the first rather than stacking.
    const notice = new Notification(`Incoming call · ${who}`, {
      body: detail,
      tag: 'incoming-call',
      requireInteraction: true,
    });
    notice.onclick = () => {
      window.focus();
      notice.close();
    };
    return () => notice.close();
  } catch {
    // Some browsers allow notifications only from a service worker.
    return () => undefined;
  }
}
