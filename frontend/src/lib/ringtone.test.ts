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
  it('plays its melody, again after a pause, and stops when told', async () => {
    const { startRinging } = await fresh();
    const stop = startRinging();
    const audio = FakeAudio.made[0];
    audio.state = 'running';
    vi.advanceTimersByTime(2400);
    const once = audio.tones;
    // Eight notes, each a tone and its overtone.
    expect(once).toBe(16);
    vi.advanceTimersByTime(2400);
    expect(audio.tones).toBe(once * 2);

    stop();
    vi.advanceTimersByTime(9000);
    expect(audio.tones).toBe(once * 2);
  });

  it('stays silent, without failing, while the browser refuses sound', async () => {
    const { startRinging, canRing } = await fresh();
    const stop = startRinging();
    vi.advanceTimersByTime(6000);
    expect(FakeAudio.made[0].tones).toBe(0);
    expect(canRing()).toBe(false);
    stop();
  });

  it('is woken by the first click anywhere on the page', async () => {
    const { armRingtone } = await fresh();
    const disarm = armRingtone();
    window.dispatchEvent(new Event('pointerdown'));
    expect(FakeAudio.made[0].resume).toHaveBeenCalled();
    disarm();
  });

  it('does nothing where there is no audio at all', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { startRinging, canRing } = await fresh();
    expect(canRing()).toBe(false);
    expect(() => startRinging()()).not.toThrow();
  });
});
