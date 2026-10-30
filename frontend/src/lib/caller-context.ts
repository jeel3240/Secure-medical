import type { TimelineEntry } from '../api/workspace';
import { formatRelative } from './format';

/**
 * Why this lead is probably calling, in one line for the incoming-call card -
 * "Calling back · you tried 2× today". Pure: it reads the lead's timeline.
 *
 * Calls an agent placed come first - not one the lead placed, and not the
 * server's automated call (T5, docs/AUTO-CALLS.md): "you tried 2×" and "Sam
 * tried" are about people. With none, the automated call is what they are
 * returning - its voicemail asks them to call back (T19): "Calling back ·
 * automated call, 2h ago". Null when we never called them: the card then says
 * nothing rather than guessing.
 */
export function callerContext(entries: TimelineEntry[], myName: string, now: Date): string | null {
  const placed = entries.filter((e) => e.kind === 'call' && e.detail.direction === 'outbound');
  if (placed.length === 0) {
    const robot = entries.filter((e) => e.kind === 'call' && e.detail.direction === 'automated');
    if (robot.length === 0) return null;
    const last = robot.reduce((a, b) => (a.at > b.at ? a : b));
    return `Calling back · automated call, ${formatRelative(last.at, now)}`;
  }

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

/**
 * The line in place of "Calling back" when the call is a transfer from the
 * automated call - T11, AUTO-CALLS.md: "Transfer · said yes to the offer", from
 * the heading of the question the lead said yes to. A transfer is not a lead
 * returning anyone's call, so it never says "Calling back".
 */
export function transferContext(step: string): string {
  const what = step.trim().toLowerCase();
  return what ? `Transfer · said yes to the ${what}` : 'Transfer · said yes';
}
