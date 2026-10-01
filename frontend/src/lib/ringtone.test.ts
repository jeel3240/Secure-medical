import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for the browser's audio: counts the tones started. */
class FakeAudio {
  static made: FakeAudio[] = [];
  state = 'suspended';
  currentTime = 0;
  destination = {};
  tones = 0;
  constructor() {
    FakeAudio.made.push(this);
  }
  resume = vi.fn(async () => undefined);
  sampleRate = 44100;
  createBuffer = vi.fn(() => ({}));
  silence = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
  createBufferSource = () => this.silence;
  createGain = () => ({
    gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  });
  createOscillator = () => {
    this.tones += 1;
    return { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  };
}

async function fresh() {
  FakeAudio.made = [];
  vi.resetModules();
  return import('./ringtone');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeAudio);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the ring of an incoming call', () => {
  /** A page that has been clicked on: its audio exists and is running. */
  async function clicked() {
    const ringtone = await fresh();
    ringtone.armRingtone();
    window.dispatchEvent(new Event('click'));
    const audio = FakeAudio.made[0];
    audio.state = 'running';
    return { ...ringtone, audio };
  }

  it('plays its melody, again after a pause, and stops when told', async () => {
    const { startRinging, audio } = await clicked();
    const stop = startRinging();
    // Eight notes, each a tone and its overtone.
    expect(audio.tones).toBe(16);
    vi.advanceTimersByTime(2400);
    expect(audio.tones).toBe(32);

    stop();
    vi.advanceTimersByTime(9000);
    expect(audio.tones).toBe(32);
  });

  it('on a page nobody has clicked: silent, makes no audio of its own, and starts once they click', async () => {
    const { startRinging, armRingtone, canRing } = await fresh();
    armRingtone();
    const stop = startRinging();
    vi.advanceTimersByTime(4800);
    expect(FakeAudio.made).toHaveLength(0);
    expect(canRing()).toBe(false);

    window.dispatchEvent(new Event('click'));
    FakeAudio.made[0].state = 'running';
    vi.advanceTimersByTime(2400);
    expect(FakeAudio.made[0].tones).toBe(16);
    stop();
  });

  it('creates no audio while the page loads - Safari plays nothing from one made before a click', async () => {
    const { armRingtone, canRing } = await fresh();
    const disarm = armRingtone();
    expect(canRing()).toBe(false);
    expect(FakeAudio.made).toHaveLength(0);
    disarm();
  });

  it('is made and woken by the first click anywhere on the page, with the silent buffer Safari needs', async () => {
    const { armRingtone, canRing } = await fresh();
    const disarm = armRingtone();
    window.dispatchEvent(new Event('click'));
    const audio = FakeAudio.made[0];
    expect(audio.resume).toHaveBeenCalled();
    expect(audio.silence.start).toHaveBeenCalled();
    audio.state = 'running';
    expect(canRing()).toBe(true);

    window.dispatchEvent(new Event('keydown'));
    expect(FakeAudio.made).toHaveLength(1);
    disarm();
  });

  it('does nothing where there is no audio at all', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { startRinging, canRing } = await fresh();
    expect(canRing()).toBe(false);
    expect(() => startRinging()()).not.toThrow();
  });
});
