/**
 * The sound of an incoming call - TWILIO.md, "Incoming calls".
 *
 * Our own, made in the browser, rather than the ringtone Twilio's SDK plays:
 * that one did not sound on the first real calls (Jeel, 2026-10-01), and a
 * call an agent cannot hear is a missed call. Two tones, the pair a US phone
 * line rings with, one second on and two off, until it is stopped.
 *
 * **A browser will not play sound on a page nobody has touched.** `armRingtone`
 * wakes the audio on the first click or key press anywhere, so by the time a
 * call comes it can ring. After a reload with no click since, it stays silent:
 * `canRing()` says so, and the app shows a line asking for one click.
 */

const TONES_HZ = [440, 480];
const ON_SECONDS = 1;
const EVERY_MS = 3000;
// Loud enough to hear across a desk on laptop speakers; two tones add up.
const VOLUME = 0.3;

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

/** Wakes the audio on the first click or key press. Returns how to stop listening. */
export function armRingtone(): () => void {
  const wake = () => void audio()?.resume().catch(() => undefined);
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  return () => {
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
}

/** False while the browser is still refusing sound: nobody has clicked on the page yet. */
export function canRing(): boolean {
  const ctx = audio();
  return ctx !== null && ctx.state === 'running';
}

function burst(ctx: AudioContext): void {
  const gain = ctx.createGain();
  const start = ctx.currentTime;
  // A short fade each side, so the tone does not click on and off.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(VOLUME, start + 0.03);
  gain.gain.setValueAtTime(VOLUME, start + ON_SECONDS - 0.05);
  gain.gain.linearRampToValueAtTime(0, start + ON_SECONDS);
  gain.connect(ctx.destination);
  for (const hz of TONES_HZ) {
    const tone = ctx.createOscillator();
    tone.frequency.value = hz;
    tone.connect(gain);
    tone.start(start);
    tone.stop(start + ON_SECONDS);
  }
}

/** Rings until the returned function is called. */
export function startRinging(): () => void {
  const ctx = audio();
  if (!ctx) return () => undefined;
  // In case this is the moment it is allowed to: a refusal just stays silent.
  void ctx.resume().catch(() => undefined);

  const ring = () => ctx.state === 'running' && burst(ctx);
  ring();
  const timer = window.setInterval(ring, EVERY_MS);
  return () => window.clearInterval(timer);
}
