/**
 * The AI agent's switch - A01, docs/AI-AGENT.md section 7. A stand-in for the
 * database: what is under test is what each stored value means, and when a
 * missing key turns it off. Writing the switch, and its record, are proved
 * against a real Postgres in scripts/activity-live-check.ts.
 */
import * as logModule from '../lib/log';
import {
  parseAiAgentSwitch,
  parseSwitchArgs,
  readAiAgentOn,
  readAiAgentSwitch,
  switchRefusal,
} from './settings';

const settings = (value?: string) => ({
  query: async () => ({ rows: value === undefined ? [] : [{ value }], rowCount: 0 }),
});

describe('the switch as stored', () => {
  it('is on only when it says exactly "on"', () => {
    expect(parseAiAgentSwitch('on')).toBe('on');
    for (const raw of ['off', 'ON', ' on', 'on ', 'true', 'yes', '1', '', null, undefined]) {
      expect(parseAiAgentSwitch(raw)).toBe('off');
    }
  });

  it('is read from settings.ai_agent - missing is off', async () => {
    expect(await readAiAgentSwitch(settings())).toBe('off');
    expect(await readAiAgentSwitch(settings('on'))).toBe('on');
    expect(await readAiAgentSwitch(settings('off'))).toBe('off');
    expect(await readAiAgentSwitch(settings('ON'))).toBe('off');
    expect(await readAiAgentSwitch(settings('junk'))).toBe('off');
  });
});

describe('whether the next call goes to Seri', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(logModule.log, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('on, with a key: yes', async () => {
    expect(await readAiAgentOn(settings('on'), 'sk-test')).toBe(true);
  });

  it('off, or never set: no, key or not - and nothing logged', async () => {
    expect(await readAiAgentOn(settings('off'), 'sk-test')).toBe(false);
    expect(await readAiAgentOn(settings(), 'sk-test')).toBe(false);
    expect(await readAiAgentOn(settings('off'), '')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('on without a key: no - the script - and ai_agent.no_key logged once, not on every call', async () => {
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./settings');
      const freshLog = await import('../lib/log');
      const freshWarn = jest.spyOn(freshLog.log, 'warn').mockImplementation(() => undefined);
      expect(await fresh.readAiAgentOn(settings('on'), '')).toBe(false);
      expect(await fresh.readAiAgentOn(settings('on'), '   ')).toBe(false);
      expect(freshWarn.mock.calls).toEqual([['ai_agent.no_key']]);
      freshWarn.mockRestore();
    });
  });
});

describe('the command', () => {
  it('takes exactly one argument, on or off', () => {
    expect(parseSwitchArgs(['on'])).toBe('on');
    expect(parseSwitchArgs(['off'])).toBe('off');
    for (const args of [[], ['ON'], ['yes'], ['on', 'off'], ['--on'], ['']]) {
      expect(parseSwitchArgs(args)).toBeNull();
    }
  });

  it('refuses on without a key - off is always allowed', () => {
    expect(switchRefusal('on', '')).toBe('no_key');
    expect(switchRefusal('on', '  ')).toBe('no_key');
    expect(switchRefusal('on', 'sk-test')).toBeNull();
    expect(switchRefusal('off', '')).toBeNull();
  });
});

describe('the key never reaches a log line', () => {
  it('a field holding it is redacted, whatever it is called', () => {
    const out = logModule.redact({ openaiApiKey: 'sk-secret', OPENAI_API_KEY: 'sk-secret', apiKey: 'sk-secret' });
    expect(out).toEqual({ openaiApiKey: '[redacted]', OPENAI_API_KEY: '[redacted]', apiKey: '[redacted]' });
  });
});
