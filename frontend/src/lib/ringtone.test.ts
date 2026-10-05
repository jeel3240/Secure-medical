import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for the browser's audio element. `allowed` is the browser letting it play. */
class FakeAudio {
  static made: FakeAudio[] = [];
  static allowed = true;
  loop = false;
  muted = false;
  volume = 1;
  /** Whether anything would have been heard at any moment it was playing. */
  heard = false;
  preload = '';
  currentTime = 0;
  playing = false;
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
  play = vi.fn(() => {
    if (!FakeAudio.allowed) return Promise.reject(new Error('NotAllowedError'));
    this.playing = true;
    if (!this.muted && this.volume > 0) this.heard = true;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.playing = false;
  });
}

async function fresh() {
  FakeAudio.made = [];
  FakeAudio.allowed = true;
  vi.resetModules();
  return import('./ringtone');
}

/** Lets the promises a click started settle. */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:ring' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the ringtone itself', () => {
  it('is eight notes, then quiet, and never clips', async () => {
    const { melodySamples } = await fresh();
    const samples = melodySamples();
    const peak = (from: number, to: number) => samples.slice(from, to).reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    // 2.4 seconds at 22,050 samples a second.
    expect(samples.length).toBe(52920);
    expect(peak(0, samples.length)).toBeGreaterThan(0.3);
    expect(peak(0, samples.length)).toBeLessThanOrEqual(1);
    // The last note is struck at 1.12s; by 2.2s there is only the pause.
    expect(peak(Math.round(2.2 * 22050), samples.length)).toBeLessThan(0.001);
  });

  it('is a well-formed WAV file', async () => {
    const { melodySamples, wavFile } = await fresh();
    const samples = melodySamples();
    const view = new DataView(wavFile(samples));
    const text = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(at + i)));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.byteLength).toBe(44 + samples.length * 2);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });
});

describe('ringing', () => {
  async function clicked() {
    const ringtone = await fresh();
    ringtone.armRingtone();
    window.dispatchEvent(new Event('click'));
    await settle();
    return { ...ringtone, audio: FakeAudio.made[0] };
  }

  it('one click fires several events, and plays it only once', async () => {
    const { armRingtone } = await fresh();
    armRingtone();
    ['pointerdown', 'mousedown', 'click'].forEach((name) => window.dispatchEvent(new Event(name)));
    await settle();
    expect(FakeAudio.made[0].play).toHaveBeenCalledTimes(1);
    expect(FakeAudio.made[0].heard).toBe(false);
  });

  it('the first click plays it silently for an instant, which is what lets it ring later', async () => {
    const { audio, canRing } = await clicked();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.playing).toBe(false);
    // Nothing was heard: muted and at zero volume, and left that way until it rings.
    expect(audio.heard).toBe(false);
    expect([audio.muted, audio.volume]).toEqual([true, 0]);
    expect(canRing()).toBe(true);

    window.dispatchEvent(new Event('keydown'));
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('rings aloud, on a loop, from the start, and stops when told', async () => {
    const { audio, startRinging } = await clicked();
    const stop = startRinging();
    expect(audio.playing).toBe(true);
    expect([audio.loop, audio.muted, audio.volume, audio.currentTime]).toEqual([true, false, 1, 0]);
    stop();
    expect(audio.playing).toBe(false);
  });

  it('on a page nobody has clicked: silent without failing, and rings at the first click', async () => {
    const { armRingtone, startRinging, canRing } = await fresh();
    armRingtone();
    FakeAudio.allowed = false;
    const stop = startRinging();
    await settle();
    const audio = FakeAudio.made[0];
    expect(audio.playing).toBe(false);
    expect(canRing()).toBe(false);

    FakeAudio.allowed = true;
    window.dispatchEvent(new Event('click'));
    expect(audio.playing).toBe(true);
    expect(audio.muted).toBe(false);
    stop();
  });

  it('a call arriving during the unlocking click is not cut off by it', async () => {
    const { armRingtone, startRinging } = await fresh();
    armRingtone();
    window.dispatchEvent(new Event('click'));
    const stop = startRinging();
    await settle();
    expect(FakeAudio.made[0].playing).toBe(true);
    expect([FakeAudio.made[0].muted, FakeAudio.made[0].volume]).toEqual([false, 1]);
    stop();
  });

  it('does nothing where there is no audio at all', async () => {
    vi.stubGlobal('Audio', undefined);
    const { startRinging, canRing } = await fresh();
    expect(canRing()).toBe(false);
    expect(() => startRinging()()).not.toThrow();
  });
});
