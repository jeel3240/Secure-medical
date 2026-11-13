/**
 * Asking OpenAI - A12: what a failure looks like by the time it is logged.
 * A local server in OpenAI's place, answering as OpenAI does when it refuses.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import OpenAI from 'openai';
import { openAiModel, plainError } from './openai';

describe('a failure, as the relay logs it', () => {
  it('a refused key: the status and code, never the message quoting the key', () => {
    const err = new OpenAI.AuthenticationError(
      401,
      { message: 'Incorrect API key provided: sk-abcd*****wxyz.', type: 'invalid_request_error', code: 'invalid_api_key' },
      undefined,
      new Headers()
    );
    expect(err.message).toContain('sk-abcd');
    expect((plainError(err) as Error).message).toBe('OpenAI 401 invalid_api_key');
  });

  it('a timeout, and no connection at all', () => {
    expect((plainError(new OpenAI.APIConnectionTimeoutError()) as Error).message).toBe('OpenAI timed out');
    expect((plainError(new OpenAI.APIConnectionError({ message: 'socket hang up' })) as Error).message).toBe('OpenAI could not be reached');
  });

  it('stopped on purpose, or anything else: left as it is', () => {
    const abort = new OpenAI.APIUserAbortError();
    expect(plainError(abort)).toBe(abort);
    const other = new Error('boom');
    expect(plainError(other)).toBe(other);
  });

  it('from a real request: thrown as the plain error', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-test*****-key.', type: 'invalid_request_error', code: 'invalid_api_key' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const before = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    try {
      const model = openAiModel('sk-test-not-a-key');
      const read = async () => {
        for await (const _ of model.reply([{ role: 'user', content: 'Hello?' }], new AbortController().signal)) void _;
      };
      await expect(read()).rejects.toThrow(/^OpenAI 401 invalid_api_key$/);
    } finally {
      if (before === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = before;
      await new Promise((r) => server.close(r));
    }
  });
});
