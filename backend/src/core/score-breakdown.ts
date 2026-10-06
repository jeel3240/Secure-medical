/**
 * Turning a conversation's answers into what the lead card shows: the answer
 * chips, and the score breakdown `Responded +10 · Yes +20 · Talk to an agent
 * +45 · Completed +10`.
 *
 * Pure - the caller loads the answers and passes them in.
 *
 * **The words and the points are the ones saved with each answer**
 * (`conversation_answers`, docs/FLOWS.md), not the flow's current ones - so a
 * choice renamed or re-scored later does not change what an earlier lead is
 * shown to have picked or earned. The questions are whatever the lead's flow
 * asked: two, three or five, and only the ones this lead actually answered.
 */

/** One saved answer, as `conversation_answers` holds it. */
export interface SavedAnswer {
  /** 'q1', 'offers'. */
  questionKey: string;
  /** The question's order in its flow. */
  position: number;
  /** What the screens call the question: 'Next step'. */
  heading: string;
  /** What the lead typed: '1'. */
  choice: string;
  /** What that meant: 'Talk to an agent'. */
  label: string;
  points: number;
}

export interface BreakdownLine {
  /** `responded`, `completed`, `q1_1` - what earned the points. */
  code: string;
  /** What to show: `Responded`, `Yes`, `Talk to an agent`. */
  label: string;
  points: number;
}

export interface ScoredConversation {
  score: number;
  /** How the flow ended, or null. */
  endOutcome: string | null;
  /** The flow's awards, as they stand. */
  respondedPoints: number;
  completedPoints: number;
}

const inOrder = (answers: SavedAnswer[]): SavedAnswer[] => [...answers].sort((a, b) => a.position - b.position);

/**
 * The lines that make up the score, in the order they were earned: responding,
 * then each answer, then the completion award.
 *
 * Only what the lead actually earned appears. A conversation that stopped after
 * the first question shows two lines, not five with zeros - the card is a
 * record of what happened, not a scorecard of what was possible. An answer
 * worth nothing ("No") is still listed: it is what they said.
 */
export function scoreBreakdown(conversation: ScoredConversation, answers: SavedAnswer[]): BreakdownLine[] {
  const lines: BreakdownLine[] = [];

  // Responding at all is earned by any reply, which is exactly what having a
  // score above zero means - see STATE-MACHINE.md, "Scoring".
  if (conversation.score > 0 && conversation.respondedPoints > 0) {
    lines.push({ code: 'responded', label: 'Responded', points: conversation.respondedPoints });
  }

  for (const a of inOrder(answers)) {
    lines.push({ code: `${a.questionKey}_${a.choice}`, label: a.label, points: a.points });
  }

  if (conversation.endOutcome === 'completed' && conversation.completedPoints > 0) {
    lines.push({ code: 'completed', label: 'Completed', points: conversation.completedPoints });
  }

  return lines;
}

export interface AnswerChip {
  /** The question's order in its flow. */
  question: number;
  /** The question's key: 'q1', 'offers'. */
  key: string;
  heading: string;
  answer: string;
  /**
   * The raw choice the lead sent - `1`, `2` or `3`.
   *
   * The label alone is not enough for the conversation view, which wants to
   * write an inbound `3` as "3 Order online". Pairing a reply with a question
   * by counting inbound messages is wrong the moment one of them was unclear,
   * so the screen matches the digit against this instead and labels nothing it
   * cannot prove.
   */
  choice: string;
}

/**
 * The answer chips: `Requested info: Yes`, `Next step: Talk to an agent`. One
 * per question the lead answered, in the flow's order - a question on a branch
 * they never took is not shown as unanswered, because they were never asked.
 */
export function answerChips(answers: SavedAnswer[]): AnswerChip[] {
  return inOrder(answers).map((a) => ({
    question: a.position,
    key: a.questionKey,
    heading: a.heading,
    answer: a.label,
    choice: a.choice,
  }));
}
