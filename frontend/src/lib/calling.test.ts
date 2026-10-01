import { describe, expect, it } from 'vitest';
import { describeCallError } from './calling';

const twilioError = (code: number) => Object.assign(new Error('twilio'), { code });
const named = (name: string) => Object.assign(new Error(name), { name });
const apiError = (status: number, error: string) => ({
  isAxiosError: true,
  response: { status, data: { error, message: 'from the API' } },
});

describe('a call that could not be placed, in words an agent can act on', () => {
  it.each([
    ['the microphone was refused (Twilio)', twilioError(31401), /Allow microphone access/],
    ['the microphone was refused (browser)', named('NotAllowedError'), /Allow microphone access/],
    ['there is no microphone', twilioError(31402), /No microphone was found/],
    ['the calling session expired', twilioError(20104), /session expired/],
    ['the connection dropped', twilioError(31005), /Check your internet/],
    ['calling is off on the server', apiError(503, 'calling_off'), /not set up/],
    ['the agent is signed out', apiError(401, 'unauthorized'), /Sign in again/],
  ])('%s', (_, err, words) => {
    expect(describeCallError(err)).toMatch(words);
  });

  it('anything else is a plain "try again", never a code', () => {
    expect(describeCallError(twilioError(99999))).toBe('The call could not be placed. Try again.');
    expect(describeCallError(undefined)).toBe('The call could not be placed. Try again.');
  });
});
