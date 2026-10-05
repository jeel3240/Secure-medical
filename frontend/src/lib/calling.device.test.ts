/**
 * Placing and receiving a call, against a stand-in for Twilio's SDK.
 *
 * Added 2026-10-01 after Accept failed on a real call: the function joining a
 * call's events to the screen had been left calling itself, and nothing ran
 * it - every other test stops at the pure state or mocks this file whole.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

class Emitter {
  private listeners = new Map<string, Listener[]>();
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string, ...args: unknown[]) {
    (this.listeners.get(event) ?? []).forEach((listener) => listener(...args));
  }
}

class FakeCall extends Emitter {
  customParameters = new Map([
    ['leadId', '7'],
    ['leadName', 'Priya Sharma'],
    ['leadPhone', '+15550100016'],
  ]);
  parameters = { From: '+15550100016' };
  accept = vi.fn();
  reject = vi.fn();
  disconnect = vi.fn();
  mute = vi.fn();
  sendDigits = vi.fn();
}

class FakeDevice extends Emitter {
  state = 'unregistered';
  outgoing = new FakeCall();
  register = vi.fn(async () => {
    this.state = 'registered';
  });
  connect = vi.fn(async () => this.outgoing);
  audio = { incoming: vi.fn() };
  updateToken = vi.fn();
  destroy = vi.fn();
}

let device: FakeDevice;
vi.mock('@twilio/voice-sdk', () => ({
  Device: vi.fn(() => {
    device = new FakeDevice();
    return device;
  }),
}));
vi.mock('../api/calls', () => ({ getCallToken: vi.fn(async () => 'token') }));

const handlers = () => ({
  onRinging: vi.fn(),
  onAnswered: vi.fn(),
  onMuted: vi.fn(),
  onEnded: vi.fn(),
  onFailed: vi.fn(),
});

async function fresh() {
  // A new copy of the module, and so a new device, for each test.
  device = undefined as unknown as FakeDevice;
  vi.resetModules();
  return import('./calling');
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('calling a lead', () => {
  it('reports ringing, answered, muted and the end, and gives working controls', async () => {
    const { placeCall } = await fresh();
    const on = handlers();
    const handle = await placeCall(7, on);
    expect(device.connect).toHaveBeenCalledWith({ params: { leadId: '7' } });

    device.outgoing.emit('ringing');
    device.outgoing.emit('accept');
    device.outgoing.emit('mute', true);
    expect(on.onRinging).toHaveBeenCalled();
    expect(on.onAnswered).toHaveBeenCalled();
    expect(on.onMuted).toHaveBeenCalledWith(true);

    handle.setMuted(false);
    handle.sendDigits('5');
    handle.hangUp();
    expect(device.outgoing.mute).toHaveBeenCalledWith(false);
    expect(device.outgoing.sendDigits).toHaveBeenCalledWith('5');
    expect(device.outgoing.disconnect).toHaveBeenCalled();

    device.outgoing.emit('disconnect');
    device.outgoing.emit('disconnect');
    expect(on.onEnded).toHaveBeenCalledTimes(1);
  });

  it('a call that breaks is reported in words, and the device is thrown away', async () => {
    const { placeCall } = await fresh();
    const on = handlers();
    await placeCall(7, on);
    const used = device;
    used.outgoing.emit('error', Object.assign(new Error('x'), { code: 31005 }));
    expect(on.onFailed).toHaveBeenCalledWith(expect.stringMatching(/did not connect/));
    await vi.waitFor(() => expect(used.destroy).toHaveBeenCalled());
  });
});

describe('a lead calling in', () => {
  async function ringing() {
    const { listenForCalls } = await fresh();
    const incoming = { onRing: vi.fn(), onRingOver: vi.fn() };
    const stop = listenForCalls(incoming);
    await vi.waitFor(() => expect(device?.register).toHaveBeenCalled());
    const call = new FakeCall();
    device.emit('incoming', call);
    const ring = incoming.onRing.mock.calls[0][0];
    return { incoming, stop, call, ring, used: device };
  }

  it('registers the browser, and says who is calling', async () => {
    const { ring, stop } = await ringing();
    expect(ring.lead).toEqual({ id: 7, name: 'Priya Sharma', phone: '+15550100016' });
    // The ring is the app's own, so Twilio's is switched off - never two at once.
    expect(device.audio.incoming).toHaveBeenCalledWith(false);
    stop();
  });

  it('answer: picks up, and from there it is an ordinary call', async () => {
    const { ring, call, incoming, stop } = await ringing();
    const on = handlers();
    const handle = ring.answer(on);
    expect(call.accept).toHaveBeenCalled();

    call.emit('accept');
    expect(on.onAnswered).toHaveBeenCalled();
    handle.hangUp();
    expect(call.disconnect).toHaveBeenCalled();
    call.emit('disconnect');
    expect(on.onEnded).toHaveBeenCalledTimes(1);
    expect(incoming.onRingOver).not.toHaveBeenCalled();
    stop();
  });

  it('not answered: the ring ending is reported, once, as over', async () => {
    const { ring, call, incoming, stop } = await ringing();
    call.emit('cancel');
    expect(incoming.onRingOver).toHaveBeenCalledWith(ring);
    stop();
  });

  it('decline: rejects the call, and is not reported as a ring that ran out', async () => {
    const { ring, call, incoming, stop } = await ringing();
    ring.decline();
    expect(call.reject).toHaveBeenCalled();
    call.emit('cancel');
    expect(incoming.onRingOver).not.toHaveBeenCalled();
    stop();
  });

  it('stopping - signing out - destroys the device, so the browser cannot ring', async () => {
    const { stop, used } = await ringing();
    stop();
    await vi.waitFor(() => expect(used.destroy).toHaveBeenCalled());
  });
});
