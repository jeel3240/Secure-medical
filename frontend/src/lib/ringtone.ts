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

const supported = (): boolean => typeof AudioContext !== 'undefined';

function audio(): AudioContext | null {
  if (!supported()) return null;
  context ??= new AudioContext();
  return context;
}

/** Every event a browser counts as the user touching the page - they differ on which. */
const GESTURES = ['pointerdown', 'mousedown', 'click', 'touchend', 'keydown'] as const;

/**
 * Wakes the audio on the first click or key press. Returns how to stop listening.
 *
 * **The audio is created here, inside the click, and not before** - found in
 * Safari, 2026-10-01: a context created while the page loads can be resumed
 * later and report itself running, and Safari shows its speaker icon, yet
 * nothing is heard. Created and started inside a real click it plays. The
 * one-sample silent buffer is the long-standing way to make Safari commit to
 * that.
 */
export function armRingtone(): () => void {
  const wake = () => {
    const ctx = audio();
    if (!ctx) return;
    void ctx.resume().catch(() => undefined);
    const silence = ctx.createBufferSource();
    silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silence.connect(ctx.destination);
    silence.start();
  };
  GESTURES.forEach((gesture) => window.addEventListener(gesture, wake));
  return () => GESTURES.forEach((gesture) => window.removeEventListener(gesture, wake));
}

/**
 * False while the browser is still refusing sound: nobody has clicked on the
 * page yet. Does not create the audio - see `armRingtone`.
 */
export function canRing(): boolean {
  return context !== null && context.state === 'running';
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

/**
 * Rings until the returned function is called.
 *
 * Uses the audio a click made and never makes its own, for the reason above.
 * If nobody has clicked yet it is silent, and starts at the next round once
 * they do.
 */
export function startRinging(): () => void {
  if (!supported()) return () => undefined;
  const ring = () => {
    if (context?.state === 'running') burst(context);
  };
  ring();
  const timer = window.setInterval(ring, EVERY_MS);
  return () => window.clearInterval(timer);
}
