/**
 * Whether Seri can take calls, before the robot places any - A17,
 * docs/AI-AGENT.md section 6. OpenAI is a local server here, answering as
 * OpenAI does; the fallback streak's SQL is proved in
 * scripts/ai-agent-live-check.ts.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { cachedProbe, openAiProbe, seriState, type Probe } from './health';

/** A stand-in for OpenAI: every request gets `status` and `body`. Returns what it was asked. */
async function withOpenAi<T>(status: number, body: unknown, run: (asked: unknown[]) => Promise<T>): Promise<T> {
  const asked: unknown[] = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      asked.push({ path: req.url, body: JSON.parse(data || '{}') });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const before = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  try {
    return await run(asked);
  } finally {
    if (before === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = before;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const COMPLETION = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 0,
  model: 'gpt-4.1-mini',
  choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'length' }],
};

describe('asking OpenAI', () => {
  it('answers: up - one word asked of her own model', async () => {
    await withOpenAi(200, COMPLETION, async (asked) => {
      expect(await openAiProbe('sk-test')()).toEqual({ ok: true });
      expect(asked).toEqual([
        {
          path: '/v1/chat/completions',
          body: { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'Say OK.' }], max_completion_tokens: 1 },
        },
      ]);
    });
  });

  it('refuses the key: down, with its status and code - never its message, which quotes the key', async () => {
    const refused = { error: { message: 'Incorrect API key provided: sk-abc*****xyz', type: 'invalid_request_error', code: 'invalid_api_key' } };
    await withOpenAi(401, refused, async () => {
      expect(await openAiProbe('sk-abc-wrong-xyz')()).toEqual({ ok: false, err: 'OpenAI 401 invalid_api_key' });
    });
  });

  it('fails: down, once - no retries', async () => {
    await withOpenAi(500, { error: { message: 'boom', type: 'server_error' } }, async (asked) => {
      expect(await openAiProbe('sk-test')()).toEqual({ ok: false, err: 'OpenAI 500 server_error' });
      expect(asked).toHaveLength(1);
    });
  });
});

describe('asked at most once a minute', () => {
  const up: Probe = { ok: true };
  const down: Probe = { ok: false, err: 'OpenAI 503' };

  it('the answer, up or down, is kept for a minute, then asked again', async () => {
    let clock = 0;
    const probe = jest.fn<Promise<Probe>, []>().mockResolvedValueOnce(down).mockResolvedValueOnce(up);
    const check = cachedProbe(probe, { now: () => clock });
    expect(await check()).toEqual(down);
    clock = 59_999;
    expect(await check()).toEqual(down);
    expect(probe).toHaveBeenCalledTimes(1);
    clock = 60_000;
    expect(await check()).toEqual(up);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('two looks at once share one request', async () => {
    let release: (p: Probe) => void = () => undefined;
    const probe = jest.fn(() => new Promise<Probe>((resolve) => (release = resolve)));
    const check = cachedProbe(probe);
    const both = Promise.all([check(), check()]);
    release(up);
    expect(await both).toEqual([up, up]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('a probe that throws is down', async () => {
    const check = cachedProbe(async () => {
      throw new Error('no network');
    });
    expect(await check()).toEqual({ ok: false, err: 'OpenAI failed' });
  });
});

describe('Seri\'s state, for the robot', () => {
  const asked = () => {
    const calls: string[] = [];
    return {
      calls,
      deps: (on: boolean, paused: boolean, probe: Probe) => ({
        on: async () => (calls.push('on'), on),
        paused: async () => (calls.push('paused'), paused),
        probe: async () => (calls.push('probe'), probe),
      }),
    };
  };

  it('off: nothing else asked - OpenAI is never reached for the script', async () => {
    const { calls, deps } = asked();
    expect(await seriState(deps(false, true, { ok: true }))()).toEqual({ state: 'off' });
    expect(calls).toEqual(['on']);
  });

  it('paused after three fallbacks: OpenAI not asked meanwhile', async () => {
    const { calls, deps } = asked();
    expect(await seriState(deps(true, true, { ok: true }))()).toEqual({ state: 'fallbacks' });
    expect(calls).toEqual(['on', 'paused']);
  });

  it('then OpenAI: ready, or down with why', async () => {
    const { deps } = asked();
    expect(await seriState(deps(true, false, { ok: true }))()).toEqual({ state: 'ready' });
    expect(await seriState(deps(true, false, { ok: false, err: 'OpenAI timed out' }))()).toEqual({
      state: 'openai_down',
      err: 'OpenAI timed out',
    });
  });
});
