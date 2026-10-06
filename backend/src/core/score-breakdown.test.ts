import { answerChips, scoreBreakdown, type SavedAnswer } from './score-breakdown';

const yes: SavedAnswer = { questionKey: 'q1', position: 1, heading: 'Requested info', choice: '1', label: 'Yes', points: 20 };
const tele: SavedAnswer = { questionKey: 'q2', position: 2, heading: 'Used telemedicine', choice: '2', label: 'No', points: 5 };
const agent: SavedAnswer = { questionKey: 'q3', position: 3, heading: 'Next step', choice: '2', label: 'Talk to an agent', points: 45 };
const no: SavedAnswer = { ...yes, choice: '2', label: 'No', points: 0 };
const offers: SavedAnswer = { questionKey: 'offers', position: 4, heading: 'Offers', choice: '1', label: 'Special offers', points: 0 };

const AWARDS = { respondedPoints: 10, completedPoints: 10 };

describe('the score breakdown', () => {
  it('lists what was earned, in the order it was earned, and adds up to the score', () => {
    const lines = scoreBreakdown({ score: 90, endOutcome: 'completed', ...AWARDS }, [agent, yes, tele]);
    expect(lines).toEqual([
      { code: 'responded', label: 'Responded', points: 10 },
      { code: 'q1_1', label: 'Yes', heading: 'Requested info', points: 20 },
      { code: 'q2_2', label: 'No', heading: 'Used telemedicine', points: 5 },
      { code: 'q3_2', label: 'Talk to an agent', heading: 'Next step', points: 45 },
      { code: 'completed', label: 'Completed', points: 10 },
    ]);
    expect(lines.reduce((total, l) => total + l.points, 0)).toBe(90);
  });

  it('a lead partway through shows only what they have done', () => {
    expect(scoreBreakdown({ score: 30, endOutcome: null, ...AWARDS }, [yes]).map((l) => l.code)).toEqual(['responded', 'q1_1']);
  });

  it('a lead who has not replied shows nothing', () => {
    expect(scoreBreakdown({ score: 0, endOutcome: null, ...AWARDS }, [])).toEqual([]);
  });

  it('"No", then offers: no completion award - they did not finish the questions', () => {
    const lines = scoreBreakdown({ score: 10, endOutcome: 'offers', ...AWARDS }, [no, offers]);
    expect(lines.map((l) => [l.label, l.points])).toEqual([
      ['Responded', 10],
      ['No', 0],
      ['Special offers', 0],
    ]);
  });

  it('uses the points saved with the answer, not today\'s', () => {
    // The answer was worth 20 when it was given; whatever the flow says now,
    // that is what this lead earned.
    const line = scoreBreakdown({ score: 30, endOutcome: null, ...AWARDS }, [{ ...yes, points: 20, label: 'Yes (old wording)' }])[1];
    expect(line).toEqual({ code: 'q1_1', label: 'Yes (old wording)', heading: 'Requested info', points: 20 });
  });
});

describe('the answer chips', () => {
  it('one per answered question, in the flow\'s order, with the question\'s own heading', () => {
    expect(answerChips([agent, yes, tele])).toEqual([
      { question: 1, key: 'q1', heading: 'Requested info', answer: 'Yes', choice: '1' },
      { question: 2, key: 'q2', heading: 'Used telemedicine', answer: 'No', choice: '2' },
      { question: 3, key: 'q3', heading: 'Next step', answer: 'Talk to an agent', choice: '2' },
    ]);
  });

  it('a question on a branch the lead never took is not shown', () => {
    expect(answerChips([no, offers]).map((c) => c.heading)).toEqual(['Requested info', 'Offers']);
  });

  it('none for a lead who has answered nothing', () => {
    expect(answerChips([])).toEqual([]);
  });
});
