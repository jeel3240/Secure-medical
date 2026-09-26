import { answerChips, answerLabel, scoreBreakdown, type ScoringRule } from './score-breakdown';

/** The seeded rules, so these read as the real screen would. */
const RULES: ScoringRule[] = [
  { code: 'responded', label: 'Responded at all', question: 0, choice: null, points: 10 },
  { code: 'completed', label: 'Completed all questions', question: 0, choice: null, points: 10 },
  { code: 'q1_1', label: 'Q1: Supplements', question: 1, choice: '1', points: 5 },
  { code: 'q1_2', label: 'Q1: Telehealth/Rx', question: 1, choice: '2', points: 10 },
  { code: 'q1_3', label: 'Q1: Both', question: 1, choice: '3', points: 15 },
  { code: 'q2_1', label: 'Q2: Today', question: 2, choice: '1', points: 30 },
  { code: 'q2_2', label: 'Q2: This week', question: 2, choice: '2', points: 20 },
  { code: 'q2_3', label: 'Q2: Just researching', question: 2, choice: '3', points: 5 },
  { code: 'q3_1', label: 'Q3: Call me now', question: 3, choice: '1', points: 35 },
  { code: 'q3_2', label: 'Q3: Text me', question: 3, choice: '2', points: 25 },
  { code: 'q3_3', label: 'Q3: Contact me later', question: 3, choice: '3', points: 10 },
];

const conversation = (over: Partial<Parameters<typeof scoreBreakdown>[0]> = {}) => ({
  q1: null,
  q2: null,
  q3: null,
  status: 'open',
  score: 0,
  ...over,
});

describe('answerLabel', () => {
  it('strips the question prefix', () => {
    expect(answerLabel('Q1: Both')).toBe('Both');
    expect(answerLabel('Q2: Just researching')).toBe('Just researching');
    expect(answerLabel('Q3: Call me now')).toBe('Call me now');
  });

  it('leaves a label with no prefix alone', () => {
    // A rule renamed without the convention should still read sensibly rather
    // than vanishing.
    expect(answerLabel('Responded at all')).toBe('Responded at all');
    expect(answerLabel('Both')).toBe('Both');
  });
});

describe('scoreBreakdown', () => {
  it('shows the whole line for a completed conversation', () => {
    const lines = scoreBreakdown(
      conversation({ q1: '3', q2: '1', q3: '1', status: 'completed', score: 100 }),
      RULES
    );

    // The example in DESIGN-PROMPT.md section 3, in the order earned.
    expect(lines).toEqual([
      { code: 'responded', label: 'Responded', points: 10 },
      { code: 'q1_3', label: 'Both', points: 15 },
      { code: 'q2_1', label: 'Today', points: 30 },
      { code: 'q3_1', label: 'Call me now', points: 35 },
      { code: 'completed', label: 'Completed', points: 10 },
    ]);
    expect(lines.reduce((n, l) => n + l.points, 0)).toBe(100);
  });

  it('shows only what a part-way lead earned', () => {
    const lines = scoreBreakdown(conversation({ q1: '2', score: 20 }), RULES);

    // Two lines, not five with zeros: the card records what happened.
    expect(lines).toEqual([
      { code: 'responded', label: 'Responded', points: 10 },
      { code: 'q1_2', label: 'Telehealth/Rx', points: 10 },
    ]);
  });

  it('credits responding even when nothing was answered', () => {
    // An unclear reply scores 10 and answers nothing.
    const lines = scoreBreakdown(conversation({ score: 10 }), RULES);
    expect(lines).toEqual([{ code: 'responded', label: 'Responded', points: 10 }]);
  });

  it('is empty for a lead who never replied', () => {
    expect(scoreBreakdown(conversation(), RULES)).toEqual([]);
  });

  it('adds the completion line only when completed', () => {
    const open = scoreBreakdown(
      conversation({ q1: '3', q2: '1', q3: '1', status: 'open', score: 90 }),
      RULES
    );
    expect(open.map((l) => l.code)).not.toContain('completed');
  });

  it('keeps a review conversation on what it earned', () => {
    const lines = scoreBreakdown(conversation({ status: 'review', score: 10 }), RULES);
    expect(lines).toEqual([{ code: 'responded', label: 'Responded', points: 10 }]);
  });

  it('skips a rule that is missing rather than throwing', () => {
    // An admin can delete a row; a lead card is not the place to fail over it.
    const thin = RULES.filter((r) => r.code !== 'q1_3');
    const lines = scoreBreakdown(
      conversation({ q1: '3', q2: '1', status: 'open', score: 55 }),
      thin
    );
    expect(lines.map((l) => l.code)).toEqual(['responded', 'q2_1']);
  });

  it('uses whatever points the rules carry, not the seeded ones', () => {
    const doubled = RULES.map((r) => ({ ...r, points: r.points * 2 }));
    const lines = scoreBreakdown(conversation({ q1: '3', score: 50 }), doubled);
    expect(lines).toEqual([
      { code: 'responded', label: 'Responded', points: 20 },
      { code: 'q1_3', label: 'Both', points: 30 },
    ]);
  });
});

describe('answerChips', () => {
  it('names each question and the answer given', () => {
    const chips = answerChips(conversation({ q1: '3', q2: '1', q3: '1', score: 90 }), RULES);
    expect(chips).toEqual([
      { question: 1, heading: 'Interest', answer: 'Both' },
      { question: 2, heading: 'Timing', answer: 'Today' },
      { question: 3, heading: 'Prefers', answer: 'Call me now' },
    ]);
  });

  it('returns all three even when unanswered, so the card keeps its shape', () => {
    const chips = answerChips(conversation({ q1: '1', score: 15 }), RULES);
    expect(chips).toEqual([
      { question: 1, heading: 'Interest', answer: 'Supplements' },
      { question: 2, heading: 'Timing', answer: null },
      { question: 3, heading: 'Prefers', answer: null },
    ]);
  });

  it('leaves an answer null when its rule is missing', () => {
    const thin = RULES.filter((r) => r.code !== 'q2_2');
    const chips = answerChips(conversation({ q2: '2', score: 30 }), thin);
    expect(chips[1].answer).toBeNull();
  });
});
