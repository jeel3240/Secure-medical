/**
 * Turning a conversation's answers into the score breakdown the lead card
 * shows: `Responded +10 · Completed +10 · Both +15 · Today +30 · Call now +35`.
 *
 * Pure - the caller loads `scoring_rules` and passes them in.
 *
 * The words come from `scoring_rules.label`, which reads `Q1: Both`. That is
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
  status: string;
  score: number;
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

  const answers: [number, string | null][] = [
    [1, conversation.q1],
    [2, conversation.q2],
    [3, conversation.q3],
  ];
  for (const [question, choice] of answers) {
    if (choice) push(`q${question}_${choice}`);
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
}

export function answerChips(conversation: AnsweredConversation, rules: ScoringRule[]): AnswerChip[] {
  const byCode = new Map(rules.map((r) => [r.code, r]));
  const answers: [number, string | null][] = [
    [1, conversation.q1],
    [2, conversation.q2],
    [3, conversation.q3],
  ];

  return answers.map(([question, choice]) => {
    const rule = choice ? byCode.get(`q${question}_${choice}`) : undefined;
    return {
      question,
      heading: CHIP_HEADINGS[question],
      answer: rule ? answerLabel(rule.label) : null,
    };
  });
}
