/**
 * What follows Seri's part of the call - A14, docs/AI-AGENT.md section 3.
 * Pure: each action, with the lead on the line and gone; the script taking
 * over from her.
 */
import { ANTIBIOTICS_CALL, OFFER_STEP } from '../core/call-script-fixtures';
import type { Handoff } from './actions';
import { afterSeri, FALLBACK_LINE, fallbackAsk, sessionStatus } from './after';

const end = (result: string | null, extra: Record<string, unknown> = {}) => ({
  kind: 'end',
  result,
  blockNumber: false,
  sendLink: false,
  callback: null,
  ...extra,
});
const callback: Handoff = { action: 'book_callback', at: '2026-11-13T20:00:00.000Z', timeZone: 'America/New_York', reason: 'Wants to order' };

describe('how the session ended, as Twilio says it', () => {
  it('ended and completed as they are; failed, and anything else, failed', () => {
    expect(sessionStatus('ended')).toBe('ended');
    expect(sessionStatus('completed')).toBe('completed');
    for (const raw of ['failed', '', 'Ended', 'busy']) expect(sessionStatus(raw)).toBe('failed');
  });
});

describe('her action, the lead still on the line', () => {
  it.each<[string, Handoff, unknown]>([
    ['a transfer: today\'s transfer, its result decided by the ring', { action: 'transfer_to_agent' }, { kind: 'transfer' }],
    ['a call back: callback_booked, the booking handed on', callback, end('callback_booked', { callback })],
    ['the link: link_sent, texted', { action: 'send_link' }, end('link_sent', { sendLink: true })],
    ['a stop: opted_out, the number blocked', { action: 'opt_out' }, end('opted_out', { blockNumber: true })],
    ['not interested', { action: 'end_call', reason: 'not_interested' }, end('not_interested')],
    ['the wrong person: not_interested, the reason kept with her action', { action: 'end_call', reason: 'wrong_person' }, end('not_interested')],
    ['an emergency: the same', { action: 'end_call', reason: 'emergency' }, end('not_interested')],
    ['the three minutes up: the same', { action: 'end_call', reason: 'time_limit' }, end('not_interested')],
    ['silent after "are you still there?": the script\'s no_response', { action: 'end_call', reason: 'no_response' }, end('no_response')],
    ['she failed: the script', { action: 'fallback', why: 'model_slow' }, { kind: 'script' }],
  ])('%s', (_, handoff, expected) => {
    expect(afterSeri(handoff, false)).toEqual(expected);
  });
});

describe('the lead hung up', () => {
  it('a stop, the link, a call back, a no: still carried out - as said while hanging up on the script', () => {
    expect(afterSeri({ action: 'opt_out' }, true)).toEqual(end('opted_out', { blockNumber: true }));
    expect(afterSeri({ action: 'send_link' }, true)).toEqual(end('link_sent', { sendLink: true }));
    expect(afterSeri(callback, true)).toEqual(end('callback_booked', { callback }));
    expect(afterSeri({ action: 'end_call', reason: 'not_interested' }, true)).toEqual(end('not_interested'));
  });

  it('a transfer reaches nobody, silence is no answer, a fallback has nobody to ask: nothing saved - the call\'s end says hung_up', () => {
    expect(afterSeri({ action: 'transfer_to_agent' }, true)).toEqual(end(null));
    expect(afterSeri({ action: 'end_call', reason: 'no_response' }, true)).toEqual(end(null));
    expect(afterSeri({ action: 'fallback', why: 'socket_error' }, true)).toEqual(end(null));
  });

  it('before she ended with anything: nothing saved', () => {
    expect(afterSeri(null, true)).toEqual(end(null));
  });
});

describe('the script taking over from her', () => {
  it('sorry, then the first step\'s question alone - not its greeting or offer, she has said hers', () => {
    const ask = fallbackAsk(ANTIBIOTICS_CALL)!;
    expect(ask).toMatchObject({ kind: 'ask', attempt: 1, say: [FALLBACK_LINE, 'Are you interested in ordering?'] });
    expect(ask.kind === 'ask' && ask.step.id).toBe(OFFER_STEP);
    expect(ask.say.join(' ')).not.toContain('Seri');
  });

  it('a step that is only a question: said whole', () => {
    const script = { ...ANTIBIOTICS_CALL, steps: [{ ...ANTIBIOTICS_CALL.steps[0], body: 'Would you like to order?' }] };
    expect(fallbackAsk(script)?.say).toEqual([FALLBACK_LINE, 'Would you like to order?']);
  });

  it('a script with no steps: nothing to ask', () => {
    expect(fallbackAsk({ ...ANTIBIOTICS_CALL, steps: [] })).toBeNull();
  });
});
