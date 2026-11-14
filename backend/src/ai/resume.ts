/**
 * Picking a call back up after the line to our server dropped - a restart of
 * the api, or the network - docs/AI-AGENT.md section 2, "When the line drops".
 * Pure.
 *
 * Twilio keeps the call and opens the relay again (`applicationReconnect`);
 * the relay finds the call's turns as kept (`call_ai_turns`) and gives Seri
 * back the conversation so far, built as it was on the call (`leadTurn`), so
 * she goes on from where it was - not from her greeting. What the lead said
 * that she never answered is answered first.
 *
 * Not everything is in the turns: her tones (kept as words only, tone.ts), the
 * note of who was there at each turn (the one there now is given to every
 * turn), and the wrap-up note (given again with her next reply once three
 * minutes are up). An action refused is back as its note, not as the tool
 * call. Close enough for her to carry on; the lead hears no difference.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { FILLER_LINE, leadTurn } from './conversation';
import type { WhoIsThere } from './instructions';
import { INTERRUPTED_PREFIX, KEY_TURN_PREFIX } from './relay-messages';
import type { TurnWho } from './relay-store';

/** A turn as kept. */
export interface KeptTurn {
  who: TurnWho;
  text: string;
}

/** The call so far, for a conversation picked back up. */
export interface Earlier {
  /** After her greeting, as OpenAI read it on the call. */
  messages: ChatCompletionMessageParam[];
  /** What the lead said after her last reply: answered as soon as the call is picked up. */
  pending: string[];
  /** When she took the call: her limits count from it (A12). */
  startedAt: Date;
}

/** How a refused action's note begins (`refusedNote`): OpenAI is told it again. */
const REFUSED_PREFIX = 'Not done: ';

/** The words of a "Cut off" note - what the lead heard of her reply - or null when the note is another kind. */
function heardOf(note: string): string | null {
  if (!note.startsWith(INTERRUPTED_PREFIX) || !note.endsWith('"')) return null;
  return note.slice(INTERRUPTED_PREFIX.length, -1);
}

/** What she said last in `messages`, as the call's conversation reads it back (`lastReply`). */
function lastAssistant(messages: readonly ChatCompletionMessageParam[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') return typeof m.content === 'string' ? m.content : '';
  }
  return null;
}

/**
 * The conversation after her greeting, from the turns kept on the call, in
 * order. `greeting` is the first turn, and the conversation already has it.
 * The lead's turns get `who` - who is there now.
 */
export function earlierConversation(
  turns: readonly KeptTurn[],
  greeting: string,
  who: WhoIsThere
): Omit<Earlier, 'startedAt'> {
  const messages: ChatCompletionMessageParam[] = [];
  let pending: string[] = [];
  // Empty until her first reply: the greeting has no notes (`leadTurn`).
  let herLast = '';
  let lastSaid = -1;

  const rest = turns[0]?.who === 'seri' && turns[0].text === greeting ? turns.slice(1) : turns;
  for (const turn of rest) {
    if (turn.who === 'lead') {
      // A key is not words: the conversation never had it.
      if (!turn.text.startsWith(KEY_TURN_PREFIX)) pending.push(turn.text);
      continue;
    }
    if (turn.who === 'seri') {
      // "One moment..." was never in the conversation: she would start saying it herself.
      if (turn.text === FILLER_LINE) continue;
      if (pending.length > 0) {
        messages.push(...leadTurn(who, pending.join(' '), herLast));
        pending = [];
      }
      messages.push({ role: 'assistant', content: turn.text });
      herLast = turn.text;
      lastSaid = messages.length - 1;
      continue;
    }
    if (turn.who === 'system') {
      const heard = heardOf(turn.text);
      if (heard !== null && lastSaid >= 0) {
        // Talked over: she said only what the lead heard of it.
        if (heard) messages[lastSaid] = { role: 'assistant', content: heard };
        else messages.splice(lastSaid, 1);
        lastSaid = heard ? lastSaid : -1;
        herLast = lastAssistant(messages) ?? '';
      } else if (turn.text.startsWith(REFUSED_PREFIX)) {
        messages.push({ role: 'system', content: turn.text });
      }
      // Other notes - a sentence replaced, a stop, Twilio's error, an earlier
      // reconnect - are for the record: what she said is in her turn.
    }
    // An action is never here: a call she had ended is not picked up (relay.ts).
  }
  return { messages, pending };
}
