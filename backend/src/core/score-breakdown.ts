/**
 * Turning a conversation's answers into the score breakdown the lead card
 * shows: `Responded +10 · Completed +10 · Both +15 · Today +30 · Call now +35`.
 *
 * Pure - the caller loads `scoring_rules` and passes them in.
 *
 * The words are the ones saved with each answer (`conversations.q1_label`,
 * migration 009). Those in turn come from `scoring_rules.label`, which reads `Q1: Both`. That is
 * the only place the choice numbers are already paired with words and with the
 * points they earn, so the screen does not have to know that 3 means "Both".
 * The alternative was parsing the question copy in `settings`, which is prose
 * written for a lead to read and free to be reworded.
 */

export interface ScoringRule {
  code: string;
  label: string;
  question: number;
  choice: string | null;
  points: number;
}

export interface BreakdownLine {
  /** `responded`, `completed`, `q1_3` - what earned the points. */
  code: string;
  /** What to show: `Responded`, `Both`, `Call me now`. */
  label: string;
  points: number;
}

export interface AnsweredConversation {
  q1: string | null;
  q2: string | null;
  q3: string | null;
  /**
   * The word the lead chose, kept with the answer since migration 009 - so a
   * choice renamed later does not rename what an earlier lead picked. Absent
   * only on a row answered before a name existed for it; the current name is
   * used then.
   */
  q1Label?: string | null;
  q2Label?: string | null;
  q3Label?: string | null;
  status: string;
  score: number;
}

/** Each question's answer and the word saved with it, in order. */
function answersOf(c: AnsweredConversation): [number, string | null, string | null][] {
  return [
    [1, c.q1, c.q1Label ?? null],
    [2, c.q2, c.q2Label ?? null],
    [3, c.q3, c.q3Label ?? null],
  ];
}

/**
 * `Q1: Both` -> `Both`. A label with no prefix is left alone, so a rule renamed
 * without one still reads sensibly rather than disappearing.
 */
export function answerLabel(label: string): string {
  return label.replace(/^Q[123]:\s*/, '').trim() || label;
}

/**
 * The lines that make up the score, in the order they were earned: responding,
 * then each answer, then the completion award.
 *
 * Only what the lead actually earned appears. A conversation that stopped after
 * question 1 shows two lines, not five with zeros - the card is a record of
 * what happened, not a scorecard of what was possible.
 *
 * A rule missing from `scoring_rules` contributes nothing rather than throwing:
 * an admin can delete a row, and a lead card is not the place to fail over it.
 */
export function scoreBreakdown(
  conversation: AnsweredConversation,
  rules: ScoringRule[]
): BreakdownLine[] {
  const byCode = new Map(rules.map((r) => [r.code, r]));
  const lines: BreakdownLine[] = [];

  const push = (code: string, label?: string) => {
    const rule = byCode.get(code);
    if (!rule) return;
    lines.push({ code, label: label ?? answerLabel(rule.label), points: rule.points });
  };

  // Responding at all is earned by any reply, which is exactly what having a
  // score above zero means - see STATE-MACHINE.md, "Scoring".
  if (conversation.score > 0) push('responded', 'Responded');

  // The word saved with the answer, where there is one; the points are the
  // rule's as it stands.
  for (const [question, choice, saved] of answersOf(conversation)) {
    if (choice) push(`q${question}_${choice}`, saved ?? undefined);
  }

  if (conversation.status === 'completed') push('completed', 'Completed');

  return lines;
}

/**
 * The answer chips: `Interest: Both`, `Timing: Today`, `Prefers: Call me now`.
 *
 * The three headings are the screen's words for the three questions, from
 * DESIGN-PROMPT.md section 3. They are fixed here rather than derived, because
 * they describe what the question is asking rather than what the lead answered.
 */
const CHIP_HEADINGS: Record<number, string> = {
  1: 'Interest',
  2: 'Timing',
  3: 'Prefers',
};

export interface AnswerChip {
  question: number;
  heading: string;
  /** Null when the lead has not answered that question yet. */
  answer: string | null;
  /**
   * The raw choice the lead sent - `1`, `2` or `3` - or null when unanswered.
   *
   * The label alone is not enough for the conversation view, which wants to
   * write an inbound `3` as "3 Both". Pairing a reply with a question by
   * counting inbound messages is wrong the moment one of them was unclear, so
   * the screen matches the digit against this instead and labels nothing it
   * cannot prove.
   */
  choice: string | null;
}

export function answerChips(conversation: AnsweredConversation, rules: ScoringRule[]): AnswerChip[] {
  const byCode = new Map(rules.map((r) => [r.code, r]));
  return answersOf(conversation).map(([question, choice, saved]) => {
    const rule = choice ? byCode.get(`q${question}_${choice}`) : undefined;
    return {
      question,
      heading: CHIP_HEADINGS[question],
      // What they chose, as it was called when they chose it.
      answer: choice ? (saved ?? (rule ? answerLabel(rule.label) : null)) : null,
      choice: choice ?? null,
    };
  });
}
