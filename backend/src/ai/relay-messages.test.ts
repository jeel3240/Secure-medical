/**
 * The relay's messages - A10. Each shape as it arrived on the dev number's
 * test calls (A02, docs/AI-AGENT.md section 1).
 */
import twilio from 'twilio';
import {
  endMessage,
  interruptedNote,
  keyTurn,
  parseRelayMessage,
  refusedNote,
  relaySigned,
  relayUrl,
  replacedNote,
  stopNote,
  textMessage,
  twilioErrorNote,
} from './relay-messages';

const TOKEN = 'test-auth-token';
const PUBLIC = 'https://calls.example.test';

describe('the relay\'s address', () => {
  it('is the public address, as wss://', () => {
    expect(relayUrl(PUBLIC)).toBe('wss://calls.example.test/api/ai/relay');
  });

  it('keeps a path the public address has', () => {
    expect(relayUrl('https://example.test/app')).toBe('wss://example.test/app/api/ai/relay');
  });
});

describe('a connection signed by Twilio', () => {
  const sign = (url: string) => twilio.getExpectedTwilioSignature(TOKEN, url, {});

  it('for the wss:// address as the TwiML gave it: accepted', () => {
    expect(relaySigned(TOKEN, PUBLIC, { signature: sign('wss://calls.example.test/api/ai/relay'), url: '/api/ai/relay' })).toBe(true);
  });

  it('with a query, signed with it: accepted', () => {
    const url = '/api/ai/relay?voice=1';
    expect(relaySigned(TOKEN, PUBLIC, { signature: sign('wss://calls.example.test' + url), url })).toBe(true);
  });

  it('signed for the https:// address: refused - Twilio signs the wss:// one', () => {
    expect(relaySigned(TOKEN, PUBLIC, { signature: sign('https://calls.example.test/api/ai/relay'), url: '/api/ai/relay' })).toBe(false);
  });

  it('signed without the query it came with: refused', () => {
    expect(relaySigned(TOKEN, PUBLIC, { signature: sign('wss://calls.example.test/api/ai/relay'), url: '/api/ai/relay?x=1' })).toBe(false);
  });

  it('signed for another host, with another token, or not at all: refused', () => {
    const url = '/api/ai/relay';
    expect(relaySigned(TOKEN, PUBLIC, { signature: sign('wss://other.example.test' + url), url })).toBe(false);
    expect(
      relaySigned(TOKEN, PUBLIC, { signature: twilio.getExpectedTwilioSignature('other', 'wss://calls.example.test' + url, {}), url })
    ).toBe(false);
    expect(relaySigned(TOKEN, PUBLIC, { signature: undefined, url })).toBe(false);
    expect(relaySigned(TOKEN, PUBLIC, { signature: '', url })).toBe(false);
  });
});

describe('reading what Twilio sends', () => {
  const read = (m: unknown) => parseRelayMessage(JSON.stringify(m));
  const setup = (callSid: string, callId: number | null) => ({ type: 'setup', callSid, callId, reconnect: false, attempt: null });

  it('setup: Twilio\'s call, and our row from the <Parameter>', () => {
    expect(
      read({
        type: 'setup',
        sessionId: 'VX1',
        callSid: 'CA1',
        parentCallSid: '',
        from: '+15550001111',
        to: '+14805308582',
        direction: 'outbound-api',
        callType: 'PSTN',
        callStatus: 'IN_PROGRESS',
        customParameters: { call: '52' },
      })
    ).toEqual({ type: 'setup', callSid: 'CA1', callId: 52, reconnect: false, attempt: null });
  });

  it('setup after a drop: a reconnect, and which attempt - Twilio\'s `connectionType` and `reconnectAttempt`', () => {
    const base = { type: 'setup', callSid: 'CA1', customParameters: { call: '52' } };
    expect(read({ ...base, connectionType: 'reconnect', reconnectAttempt: 2 })).toEqual({
      type: 'setup',
      callSid: 'CA1',
      callId: 52,
      reconnect: true,
      attempt: 2,
    });
    expect(read({ ...base, connectionType: 'reconnect' })).toMatchObject({ reconnect: true, attempt: null });
    expect(read({ ...base, connectionType: 'reconnect', reconnectAttempt: 'x' })).toMatchObject({ reconnect: true, attempt: null });
    expect(read({ ...base, connectionType: 'reconnect', reconnectAttempt: 0 })).toMatchObject({ reconnect: true, attempt: null });
    // The first connection, said or not.
    expect(read({ ...base, connectionType: 'initial' })).toMatchObject({ reconnect: false, attempt: null });
    expect(read({ ...base, connectionType: 'initial', reconnectAttempt: 1 })).toMatchObject({ reconnect: false, attempt: null });
  });

  it('setup with no row, or one that is not a row id: no call', () => {
    for (const call of [undefined, '', '0', '-3', '5.5', 'abc', '52x', '99999999999', 52]) {
      expect(read({ type: 'setup', callSid: 'CA1', customParameters: { call } })).toEqual(setup('CA1', null));
    }
    expect(read({ type: 'setup', callSid: 'CA1' })).toEqual(setup('CA1', null));
    expect(read({ type: 'setup' })).toEqual(setup('', null));
  });

  it('a prompt: the words, trimmed, and whether they are the last', () => {
    expect(read({ type: 'prompt', voicePrompt: ' How can you help me? ', lang: 'en-US', last: true })).toEqual({
      type: 'prompt',
      text: 'How can you help me?',
      last: true,
    });
    expect(read({ type: 'prompt', voicePrompt: 'How can', last: false })).toEqual({ type: 'prompt', text: 'How can', last: false });
    expect(read({ type: 'prompt', voicePrompt: 'Yes' })).toEqual({ type: 'prompt', text: 'Yes', last: true });
  });

  it('a key', () => {
    expect(read({ type: 'dtmf', digit: '9' })).toEqual({ type: 'dtmf', digit: '9' });
  });

  it('an interrupt: what she had said, and after how long', () => {
    expect(read({ type: 'interrupt', utteranceUntilInterrupt: 'Hi, is this', durationUntilInterruptMs: 8636 })).toEqual({
      type: 'interrupt',
      heard: 'Hi, is this',
      durationMs: 8636,
    });
    expect(read({ type: 'interrupt' })).toEqual({ type: 'interrupt', heard: '', durationMs: null });
  });

  it('speaker events', () => {
    expect(read({ type: 'info', name: 'agentSpeaking', value: 'on' })).toEqual({ type: 'speaking', who: 'agent', on: true });
    expect(read({ type: 'info', name: 'clientSpeaking', value: 'off' })).toEqual({ type: 'speaking', who: 'client', on: false });
    expect(read({ type: 'info', name: 'somethingElse', value: 'on' })).toEqual({ type: 'other' });
  });

  it('an error', () => {
    expect(read({ type: 'error', description: 'Invalid message' })).toEqual({ type: 'error', description: 'Invalid message' });
  });

  it('anything else is not used; what is not a message at all is null', () => {
    expect(read({ type: 'pong' })).toEqual({ type: 'other' });
    expect(parseRelayMessage('not json')).toBeNull();
    expect(parseRelayMessage('"setup"')).toBeNull();
    expect(parseRelayMessage('null')).toBeNull();
    expect(parseRelayMessage('{"no":"type"}')).toBeNull();
  });
});

describe('what the relay sends, and keeps', () => {
  it('words: a sentence of a reply, its close, or a line on its own', () => {
    expect(JSON.parse(textMessage('Sure. ', false))).toEqual({ type: 'text', token: 'Sure. ', last: false });
    expect(JSON.parse(textMessage('', true))).toEqual({ type: 'text', token: '', last: true });
  });

  it('the end of the session, with the action as handoffData - a string, as Twilio hands it back', () => {
    expect(JSON.parse(endMessage({ action: 'end_call', reason: 'wrong_person' }))).toEqual({
      type: 'end',
      handoffData: '{"action":"end_call","reason":"wrong_person"}',
    });
  });

  it('the turns that are not words', () => {
    expect(keyTurn('9')).toBe('(pressed 9)');
    expect(interruptedNote('Hi, is this')).toBe('Cut off. Heard: "Hi, is this"');
    expect(twilioErrorNote('Invalid message')).toBe('Twilio error: Invalid message');
    expect(replacedNote('price', '$', 'It is $39.')).toBe('Replaced (price, "$"): It is $39.');
    expect(replacedNote('advice', null, 'Take two.')).toBe('Replaced (advice): Take two.');
    expect(refusedNote('transfer_to_agent', 'Nobody can take a call.')).toBe('Not done: transfer_to_agent. Nobody can take a call.');
    expect(stopNote('words')).toBe('Stop words heard: opted out.');
    expect(stopNote('key')).toBe('Stop key 9 pressed: opted out.');
  });
});
