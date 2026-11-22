import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '../api/workspace';
import { callerContext, transferContext } from './caller-context';

const NOW = new Date(2026, 9, 1, 15, 0, 0);
const at = (daysAgo: number, hour = 10) => new Date(2026, 9, 1 - daysAgo, hour, 0, 0).toISOString();
const IDS: Record<string, number> = { 'Maya Chen': 16, 'Sam Lee': 19 };
const MAYA = { id: 16 };
const call = (author: string, when: string, direction = 'outbound'): TimelineEntry => ({
  kind: 'call',
  at: when,
  author,
  detail: { direction, outcome: 'no_answer', agentId: IDS[author] ?? null },
});

describe('why a lead is probably calling', () => {
  it('"you" is by id - another agent with the same name is not you (review M32)', () => {
    const namesake: TimelineEntry = { kind: 'call', at: at(0, 9), author: 'Maya Chen', detail: { direction: 'outbound', outcome: 'no_answer', agentId: 44 } };
    expect(callerContext([namesake], MAYA, NOW)).toBe('Calling back · Maya Chen tried 1× today');
  });

  it('this agent tried them today: says how often', () => {
    const entries = [call('Maya Chen', at(0, 9)), call('Maya Chen', at(0, 11)), call('Sam Lee', at(0, 12))];
    expect(callerContext(entries, MAYA, NOW)).toBe('Calling back · you tried 2× today');
  });

  it('someone else tried them today: names them', () => {
    expect(callerContext([call('Sam Lee', at(0))], MAYA, NOW)).toBe('Calling back · Sam Lee tried 1× today');
  });

  it('nobody today, but we have called before: says when', () => {
    expect(callerContext([call('Maya Chen', at(2))], MAYA, NOW)).toMatch(/^Calling back · last called /);
  });

  it('the server\'s automated call is not an agent trying them (T5)', () => {
    const robot = call('', at(0, 9), 'automated');
    // Beside an agent's own call, only the agent's counts.
    expect(callerContext([robot, call('Maya Chen', at(0, 11))], MAYA, NOW)).toBe('Calling back · you tried 1× today');
  });

  it('only the automated call: that is what they are returning - its voicemail asked them to (T19)', () => {
    expect(callerContext([call('', at(0, 9), 'automated')], MAYA, NOW)).toBe('Calling back · automated call, 6h ago');
    expect(callerContext([call('', at(2), 'automated')], MAYA, NOW)).toBe('Calling back · automated call, 2d ago');
  });

  it('we never called them: says nothing', () => {
    expect(callerContext([], MAYA, NOW)).toBeNull();
    expect(callerContext([call('Maya Chen', at(0), 'inbound')], MAYA, NOW)).toBeNull();
    expect(callerContext([{ kind: 'note', at: at(0), author: 'Maya Chen', detail: {} }], MAYA, NOW)).toBeNull();
  });
});

describe('a transfer from the automated call (T11)', () => {
  it('says what the lead said yes to, from the question’s heading', () => {
    expect(transferContext('Offer')).toBe('Transfer · said yes to the offer');
    expect(transferContext('  Link ')).toBe('Transfer · said yes to the link');
  });

  it('with no heading, just that they said yes', () => {
    expect(transferContext('')).toBe('Transfer · said yes');
  });
});
