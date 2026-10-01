/**
 * The sound of an incoming call - TWILIO.md, "Incoming calls".
 *
 * Our own, rather than the ringtone Twilio's SDK plays: a call an agent cannot
 * hear is a missed call, and this one we control.
 *
 * **A ringtone, not a phone line's ring** - Jeel, 2026-10-01. The first
 * version played the two tones a caller hears while the other end rings, so
 * to the agent it sounded as if they were calling someone. Now a short
 * melody, the way a mobile rings: eight soft mallet-like notes rising and
 * falling, a pause, and again until it is stopped. The tune is our own.
 *
 * **Played by an ordinary audio element, from a sound made here** - the same
 * day. The melody is computed once into a WAV in memory (no file to ship or
 * license) and looped by an `<audio>` element. It was first played through the
 * Web Audio API, note by note; that rang in Chrome and was silent in Safari,
 * which showed its speaker icon and played nothing, whether the audio was
 * created before the first click or inside it. An audio element is the thing
 * every browser plays the same way.
 *
 * **A browser will not play sound on a page nobody has touched.** `armRingtone`
 * plays the element, muted, inside the first click or key press - the sign-in
 * button counts - which is what lets it play aloud later with nobody clicking.
 * After a reload with no click since, it stays silent: `canRing()` says so,
 * and the app shows a line asking for one click.
 */

/** E major, up and back: E5 G#5 B5 E6, B5 G#5 B5 E6 - in Hz. */
const MELODY_HZ = [659.25, 830.61, 987.77, 1318.51, 987.77, 830.61, 987.77, 1318.51];
const NOTE_EVERY_SECONDS = 0.16;
const NOTE_RINGS_SECONDS = 0.45;
/** The melody takes about 1.6s to die away; then a breath before it comes round again. */
const LOOP_SECONDS = 2.4;
const SAMPLE_RATE = 22050;
// Loud enough to hear across a desk on laptop speakers, with room for notes to overlap.
const VOLUME = 0.4;

/**
 * One loop of the ringtone as samples between -1 and 1. Each note is a sine
 * wave struck at once and fading out, with a quiet overtone two octaves up
 * that gives it the wooden knock. Pure, so the tune itself is tested.
 */
export function melodySamples(): Float32Array {
  const samples = new Float32Array(Math.round(LOOP_SECONDS * SAMPLE_RATE));
  MELODY_HZ.forEach((hz, i) => {
    const start = Math.round(i * NOTE_EVERY_SECONDS * SAMPLE_RATE);
    const length = Math.round(NOTE_RINGS_SECONDS * SAMPLE_RATE);
    for (let n = 0; n < length && start + n < samples.length; n++) {
      const t = n / SAMPLE_RATE;
      // A 5ms strike, so it does not click, then a tail that has gone by the end.
      const envelope = Math.min(1, t / 0.005) * Math.exp(-t * 11);
      const wave = Math.sin(2 * Math.PI * hz * t) + 0.18 * Math.sin(2 * Math.PI * hz * 4 * t);
      samples[start + n] += VOLUME * envelope * wave;
    }
  });
  return samples;
}

/** Those samples as a 16-bit mono WAV file. */
export function wavFile(samples: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const file = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(file);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));

  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // size of this block
  view.setUint16(20, 1, true); // plain PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  });
  return file;
}

let element: HTMLAudioElement | null = null;
/** The browser has let the element play once, inside a click: it may now play aloud unasked. */
let unlocked = false;
/** A call is ringing right now. */
let ringing = false;

function player(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  if (!element) {
    element = new Audio(URL.createObjectURL(new Blob([wavFile(melodySamples())], { type: 'audio/wav' })));
    element.loop = true;
    element.preload = 'auto';
  }
  return element;
}

function play(audio: HTMLAudioElement): void {
  audio.muted = false;
  audio.currentTime = 0;
  // A refusal is the browser still wanting a click; it stays silent.
  void audio.play()?.catch(() => undefined);
}

/** Every event a browser counts as the user touching the page - they differ on which. */
const GESTURES = ['pointerdown', 'mousedown', 'click', 'touchend', 'keydown'] as const;

/**
 * Lets the ringtone play later, from the first click or key press. Returns how
 * to stop listening.
 */
export function armRingtone(): () => void {
  const unlock = () => {
    const audio = player();
    if (!audio || unlocked) return;
    // A call is ringing and this is the click it was waiting for: ring.
    if (ringing) {
      unlocked = true;
      play(audio);
      return;
    }
    // Otherwise play it silently for an instant. Having played once inside a
    // click is what allows it to play aloud later with nobody clicking.
    audio.muted = true;
    void audio
      .play()
      ?.then(() => {
        unlocked = true;
        if (ringing) return;
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      })
      .catch(() => undefined);
  };
  GESTURES.forEach((gesture) => window.addEventListener(gesture, unlock));
  return () => GESTURES.forEach((gesture) => window.removeEventListener(gesture, unlock));
}

/** False while the browser is still refusing sound: nobody has clicked on the page yet. */
export function canRing(): boolean {
  return unlocked;
}

/** Rings until the returned function is called. */
export function startRinging(): () => void {
  const audio = player();
  if (!audio) return () => undefined;
  ringing = true;
  play(audio);
  return () => {
    ringing = false;
    audio.pause();
    audio.currentTime = 0;
  };
}

/**
 * Plays the ringtone once through, for an agent checking their sound - the
 * user menu's "Test ring". Called from a click, so it is allowed to play.
 */
export function testRing(): void {
  const audio = player();
  if (!audio || ringing) return;
  unlocked = true;
  play(audio);
  window.setTimeout(() => {
    if (ringing) return;
    audio.pause();
    audio.currentTime = 0;
  }, LOOP_SECONDS * 1000);
}
