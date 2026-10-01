/**
 * The sound of an incoming call - TWILIO.md, "Incoming calls".
 *
 * Our own, made in the browser, rather than the ringtone Twilio's SDK plays:
 * a call an agent cannot hear is a missed call, and this one we control.
 *
 * **A ringtone, not a phone line's ring** - Jeel, 2026-10-01. The first
 * version played the two tones a caller hears while the other end rings, so
 * to the agent it sounded as if they were calling someone. Now a short
 * melody, the way a mobile rings: eight soft mallet-like notes rising and
 * falling, a pause, and again until it is stopped. The tune is our own.
 *
 * No sound file: each note is a sine wave with a quick strike and a fading
 * tail, plus a quiet overtone two octaves up that gives it the wooden knock.
 *
 * **A browser will not play sound on a page nobody has touched.** `armRingtone`
 * wakes the audio on the first click or key press anywhere, so by the time a
 * call comes it can ring. After a reload with no click since, it stays silent:
 * `canRing()` says so, and the app shows a line asking for one click.
 */

/** E major, up and back: E5 G#5 B5 E6, B5 G#5 B5 E6 - in Hz. */
const MELODY_HZ = [659.25, 830.61, 987.77, 1318.51, 987.77, 830.61, 987.77, 1318.51];
const NOTE_EVERY_SECONDS = 0.16;
const NOTE_RINGS_SECONDS = 0.45;
/** The melody takes 1.3s; then a breath before it comes round again. */
const EVERY_MS = 2400;
// Loud enough to hear across a desk on laptop speakers.
const VOLUME = 0.35;

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

/** One note: struck at once, fading out, with its overtone. */
function note(ctx: AudioContext, hz: number, at: number): void {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(VOLUME, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, at + NOTE_RINGS_SECONDS);
  gain.connect(ctx.destination);

  const overtone = ctx.createGain();
  overtone.gain.value = 0.18;
  overtone.connect(gain);

  for (const [frequency, into] of [
    [hz, gain],
    [hz * 4, overtone],
  ] as const) {
    const tone = ctx.createOscillator();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    tone.connect(into);
    tone.start(at);
    tone.stop(at + NOTE_RINGS_SECONDS);
  }
}

/** The melody, once through. */
function burst(ctx: AudioContext): void {
  MELODY_HZ.forEach((hz, i) => note(ctx, hz, ctx.currentTime + i * NOTE_EVERY_SECONDS));
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
