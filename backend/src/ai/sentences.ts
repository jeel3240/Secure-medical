/**
 * Seri's streamed reply, cut into sentences - A11, docs/AI-AGENT.md section 1.
 * Pure.
 *
 * OpenAI writes a few words at a time. Each sentence is checked (safety.ts)
 * and sent to Twilio the moment it is whole, so she starts speaking on the
 * first sentence rather than after the last. A sentence ends at `.`, `?` or
 * `!` - with any closing quote or bracket - followed by a space; the last one
 * when the reply ends. "Dr.", "a.m." and the like do not end one.
 */

/** Words whose own full stop ends no sentence. Lower case, with the stop. */
const ABBREVIATIONS = ['mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'a.m.', 'p.m.', 'no.'];

const BOUNDARY = /[.?!]+["'”’)\]]*\s+/g;

export class SentenceSplitter {
  private buffer = '';

  /** Adds what was just written; returns the sentences it completed. */
  push(text: string): string[] {
    this.buffer += text;
    return this.take();
  }

  /** The reply has ended: what is left is its last sentence. */
  flush(): string[] {
    const out = this.take();
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) out.push(rest);
    return out;
  }

  private take(): string[] {
    const out: string[] = [];
    BOUNDARY.lastIndex = 0;
    let from = 0;
    let match: RegExpExecArray | null;
    while ((match = BOUNDARY.exec(this.buffer)) !== null) {
      const end = match.index + match[0].length;
      const sentence = this.buffer.slice(from, end).trim();
      const lastWord = sentence.split(/\s+/).pop()!.toLowerCase();
      if (ABBREVIATIONS.includes(lastWord)) continue;
      if (sentence) out.push(sentence);
      from = end;
    }
    this.buffer = this.buffer.slice(from);
    return out;
  }
}

/**
 * Whether her words ask the lead something. After a question, an action that
 * waits for the answer is held back (`waitsForAnswer`, actions.ts), and so is
 * the rest of her reply (`upToQuestion`).
 */
export function asks(text: string): boolean {
  return text.includes('?');
}

/**
 * What the lead hears of a reply that asked them something and ended with an
 * action that waits for their answer: up to the end of her first question,
 * as the relay says it (conversation.ts). The rest is never said: on A21's
 * call 95 she asked "So that's Tuesday at 12 PM your time?", then said "Great,
 * I'll schedule that call back now. Goodbye." and booked it in the same reply -
 * the booking was held back for the answer, but the lead had heard the
 * goodbye. The whole reply when it asks nothing.
 */
export function upToQuestion(text: string): string {
  const splitter = new SentenceSplitter();
  const sentences = [...splitter.push(text), ...splitter.flush()];
  const question = sentences.findIndex(asks);
  return (question < 0 ? sentences : sentences.slice(0, question + 1)).join(' ');
}
