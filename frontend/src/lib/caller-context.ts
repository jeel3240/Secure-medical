import type { TimelineEntry } from '../api/workspace';
import { formatRelative } from './format';

/**
 * Why this lead is probably calling, in one line for the incoming-call card -
 * "Calling back · you tried 2× today". Pure: it reads the lead's timeline.
 *
 * Only calls we placed count. Null when we have never called them: the card
 * then says nothing rather than guessing.
 */
export function callerContext(entries: TimelineEntry[], myName: string, now: Date): string | null {
  const placed = entries.filter((e) => e.kind === 'call' && e.detail.direction !== 'inbound');
  if (placed.length === 0) return null;

  const today = placed.filter((e) => new Date(e.at).toDateString() === now.toDateString());
  const mine = today.filter((e) => e.author === myName).length;
  if (mine > 0) return `Calling back · you tried ${mine}× today`;

  if (today.length > 0) {
    const who = today[today.length - 1].author;
    return `Calling back · ${who ?? 'an agent'} tried ${today.length}× today`;
  }

  const last = placed.reduce((a, b) => (a.at > b.at ? a : b));
  return `Calling back · last called ${formatRelative(last.at, now)}`;
}
