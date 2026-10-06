/**
 * The SMS flow, branch by branch, on the eDrugstore antibiotics flow as it is
 * seeded - docs/STATE-MACHINE.md. The last block proves the engine is not
 * about that flow: a different one, with five questions, runs on the same code.
 */
import { ANTIBIOTICS, LINK, OFFERS, Q1, Q2, Q3, RULES } from './flow-fixtures';
import { firstQuestion, step, tierFor, type Conversation, type Flow, type Rules } from './state-machine';

function fresh(overrides: Partial<Conversation> = {}): Conversation {
  return {
    status: 'open',
    step: 1,
    currentQuestionId: Q1,
    invalidCount: 0,
    score: 0,
    tier: null,
    endOutcome: null,
    ...overrides,
  };
}

const said = (text: string) => ({ text, optOut: false });

/** Walks a conversation through several replies, as a real lead would. */
function run(texts: string[], from: Conversation = fresh(), rules: Rules = RULES) {
  let last = step(from, said(texts[0]), rules);
  for (const text of texts.slice(1)) last = step(last.conversation, said(text), rules);
  return last;
}

const body = (id: number) => ANTIBIOTICS.questions.find((q) => q.id === id)!.body;

describe('a new lead', () => {
  it('is sent the question with the lowest position', () => {
    expect(firstQuestion(ANTIBIOTICS)?.key).toBe('q1');
    expect(firstQuestion({ ...ANTIBIOTICS, questions: [] })).toBeNull();
  });
});

describe('Question 1: did you request info?', () => {
  it('Yes: the reply and Question 2 in one text; 10 for replying and 20 for Yes', () => {
    const r = step(fresh(), said('1'), RULES);
    expect(r.send).toEqual(["Great! Let's get you started.", body(Q2)]);
    expect(r.conversation).toMatchObject({ status: 'open', currentQuestionId: Q2, step: 2, score: 30, tier: 'LOW' });
    expect(r.answer).toEqual({
      questionId: Q1,
      questionKey: 'q1',
      position: 1,
      heading: 'Requested info',
      choice: '1',
      label: 'Yes',
      points: 20,
    });
  });

  it('No: no more questions - "No problem." and the offers question', () => {
    const r = step(fresh(), said('2'), RULES);
    expect(r.send).toEqual(['No problem.', body(OFFERS)]);
    expect(r.conversation).toMatchObject({ status: 'open', currentQuestionId: OFFERS, score: 10, tier: 'LOW' });
    expect(r.answer).toMatchObject({ label: 'No', points: 0 });
  });

  it.each(['yes', 'Y', 'yeah', 'Sure!', 'ok'])('%j counts as Yes', (text) => {
    expect(step(fresh(), said(text), RULES).answer?.choice).toBe('1');
  });

  it.each(['no', 'N', 'nope', 'No thanks.'])('%j counts as No', (text) => {
    expect(step(fresh(), said(text), RULES).answer?.choice).toBe('2');
  });

  it('has two choices: "3" is not an answer here', () => {
    const r = step(fresh(), said('3'), RULES);
    expect(r.answer).toBeNull();
    expect(r.send).toEqual(['Sorry, please reply 1 for Yes or 2 for No.']);
  });
});

describe('Question 2: used telemedicine before?', () => {
  it.each([
    ['1', 15, 'Great. eDrugstore makes the online consultation process simple.'],
    ['2', 5, 'No problem. You can complete your information online and, when required, consult with a licensed healthcare provider.'],
  ])('%s: its own reply, then Question 3 either way', (text, points, reply) => {
    const r = run(['1', text]);
    expect(r.send).toEqual([reply, body(Q3)]);
    expect(r.conversation).toMatchObject({ currentQuestionId: Q3, step: 3, score: 30 + points });
  });
});

describe('Question 3: ready to move forward?', () => {
  it.each([
    ['1', 'I know which antibiotic', `Great. Start your online consultation here: ${LINK}`],
    ['2', 'Talk to an agent', 'Thanks! An eDrugstore representative will contact you to discuss available options, pricing and discounts.'],
    ['3', 'Order online', `Great! Start your online order and consultation here: ${LINK}`],
  ])('%s: ends the flow with its own message', (text, label, reply) => {
    const r = run(['1', '1', text]);
    expect(r.send).toEqual([reply]);
    expect(r.answer?.label).toBe(label);
    expect(r.conversation).toMatchObject({ status: 'completed', currentQuestionId: null, endOutcome: 'completed' });
  });

  it('accepts a word for each', () => {
    expect(run(['1', '1', 'agent']).answer?.choice).toBe('2');
    expect(run(['1', '1', 'Order online']).answer?.choice).toBe('3');
    expect(run(['1', '1', 'I know']).answer?.choice).toBe('1');
  });
});

describe('the score, and who agents call first', () => {
  // Replied 10 + Yes 20 + Q2 + Q3 + finished 10.
  it.each([
    [['1', '1', '2'], 100, 'HOT'],
    [['1', '2', '2'], 90, 'HOT'],
    [['1', '1', '1'], 85, 'HOT'],
    [['1', '2', '1'], 75, 'HOT'],
    [['1', '1', '3'], 65, 'WARM'],
    [['1', '2', '3'], 55, 'WARM'],
  ])('%j -> %i, %s', (texts, score, tier) => {
    expect(run(texts as string[]).conversation).toMatchObject({ score, tier });
  });

  it('"Talk to an agent" is the hottest; "Order online" is still called, after them', () => {
    expect(run(['1', '1', '2']).conversation.score).toBeGreaterThan(run(['1', '1', '1']).conversation.score);
    expect(run(['1', '1', '3']).conversation.tier).toBe('WARM');
  });

  it('replying is worth 10 once, however many replies arrive', () => {
    const r = run(['what?', '1']);
    expect(r.conversation.score).toBe(30);
  });

  it('a score of 0 has no tier', () => {
    expect(tierFor(RULES, 0)).toBeNull();
    expect(tierFor(RULES, 44)).toBe('LOW');
    expect(tierFor(RULES, 45)).toBe('WARM');
  });
});

describe('after "No": special offers, or hear from a rep', () => {
  it.each(['1', 'yes', 'Offers'])('%j: marked for offers, thanked, and not for agents', (text) => {
    const r = run(['2', text]);
    expect(r.send).toEqual(["Thanks! You'll receive special offers from eDrugstore. Reply STOP to opt out."]);
    expect(r.conversation).toMatchObject({ status: 'completed', endOutcome: 'offers', score: 10, tier: 'LOW' });
    expect(r.answer).toMatchObject({ questionKey: 'offers', label: 'Special offers' });
  });

  it.each(['2', 'learn more', 'Learn More!', 'learn', 'more'])('%j: a rep will contact them', (text) => {
    const r = run(['2', text]);
    expect(r.send).toEqual(['Thanks! An eDrugstore representative will contact you shortly.']);
    expect(r.conversation).toMatchObject({ status: 'completed', endOutcome: 'wants_contact' });
  });

  it('neither earns the "answered all the questions" 10: they answered one', () => {
    expect(run(['2', '1']).conversation.score).toBe(10);
    expect(run(['2', '2']).conversation.score).toBe(10);
  });

  it('anything else gets the offers question\'s own "sorry"', () => {
    const r = run(['2', 'maybe']);
    expect(r.send).toEqual(['Sorry, please reply 1 for offers, 2 to learn more from a rep, or STOP to unsubscribe.']);
    expect(r.conversation.currentQuestionId).toBe(OFFERS);
  });
});

describe('an unclear reply', () => {
  it('gets the question\'s "sorry" with its options, and the lead stays on that question', () => {
    const r = run(['1', '1', 'which is cheapest?']);
    expect(r.send).toEqual(['Sorry, please reply 1. I know which antibiotic I need, 2. Talk to an agent, or 3. Order online.']);
    expect(r.conversation).toMatchObject({ status: 'open', currentQuestionId: Q3, invalidCount: 1 });
    expect(r.needsPerson).toBe(false);
  });

  it('a second one hands the lead to a person: Needs review', () => {
    const r = run(['huh', 'still huh']);
    expect(r.send).toEqual(['Thanks! An eDrugstore representative will follow up with you directly.']);
    // The question stays: it is where they got stuck.
    expect(r.conversation).toMatchObject({ status: 'review', currentQuestionId: Q1, score: 10 });
    // Not flagged as an inbound reply: Needs review is what brings it to a person.
    expect(r.needsPerson).toBe(false);
  });

  it('a clear answer in between wipes the count', () => {
    const r = run(['huh', '1', 'huh']);
    expect(r.conversation).toMatchObject({ status: 'open', invalidCount: 1, currentQuestionId: Q2 });
  });

  it('the limit is the setting, not a constant', () => {
    const lenient = { ...RULES, maxInvalidBeforeReview: 2 };
    expect(run(['a', 'b'], fresh(), lenient).conversation.status).toBe('open');
    expect(run(['a', 'b', 'c'], fresh(), lenient).conversation.status).toBe('review');
  });
});

describe('STOP', () => {
  it('blocks the number and ends an open conversation, on any question, sending nothing', () => {
    for (const from of [fresh(), run(['1']).conversation, run(['2']).conversation]) {
      const r = step(from, { text: 'STOP', optOut: true }, RULES);
      expect(r).toMatchObject({ blockNumber: true, send: [], needsPerson: false, answer: null });
      expect(r.conversation).toMatchObject({ status: 'suppressed', currentQuestionId: null });
    }
  });

  it('blocks the number after the flow has ended too, leaving the conversation as it was', () => {
    const done = run(['1', '1', '2']).conversation;
    const r = step(done, { text: 'stop', optOut: true }, RULES);
    expect(r.blockNumber).toBe(true);
    expect(r.conversation).toBe(done);
  });
});

describe('a text when no question is waiting for it', () => {
  it.each(['completed', 'review', 'expired', 'suppressed'] as const)('%s: stored for a person, nothing sent or scored', (status) => {
    const c = fresh({ status, currentQuestionId: null, score: 40 });
    expect(step(c, said('1'), RULES)).toEqual({ conversation: c, send: [], blockNumber: false, needsPerson: true, answer: null });
  });

  it('an agent has taken the conversation over: the questions stop', () => {
    const c = fresh({ agentTookOverAt: '2026-10-05T10:00:00Z', score: 30, currentQuestionId: Q2 });
    expect(step(c, said('1'), RULES)).toEqual({ conversation: c, send: [], blockNumber: false, needsPerson: true, answer: null });
  });

  it('STOP still works after an agent took over', () => {
    const c = fresh({ agentTookOverAt: '2026-10-05T10:00:00Z' });
    expect(step(c, { text: 'stop', optOut: true }, RULES).blockNumber).toBe(true);
  });

  it('an open conversation on a question its flow no longer has goes to a person, not a crash', () => {
    const r = step(fresh({ currentQuestionId: 999 }), said('1'), RULES);
    expect(r).toMatchObject({ needsPerson: true, send: [], answer: null });
  });
});

describe('a flow whose rows are wrong', () => {
  /** The antibiotics flow with question 1's "Yes" pointed somewhere else. */
  const yesLeadsTo = (nextQuestionId: number): Rules => ({
    ...RULES,
    flow: {
      ...ANTIBIOTICS,
      questions: ANTIBIOTICS.questions.map((q) =>
        q.id === Q1
          ? { ...q, choices: q.choices.map((c) => (c.choice === '1' ? { ...c, nextQuestionId } : c)) }
          : q
      ),
    },
  });

  it('a choice leading to a question the flow does not have: the answer is kept and a person follows up', () => {
    const r = step(fresh(), said('yes'), yesLeadsTo(999));
    // Not completed: nothing was finished, so no completion award and no place among finished leads.
    expect(r.conversation).toMatchObject({ status: 'review', endOutcome: null, score: 30 });
    expect(r.answer).toMatchObject({ questionKey: 'q1', label: 'Yes', points: 20 });
    expect(r.send).toEqual([ANTIBIOTICS.reviewBody]);
  });

  it('a choice leading back to its own question would ask it again and score it twice: the same', () => {
    const r = step(fresh(), said('yes'), yesLeadsTo(Q1));
    expect(r.conversation).toMatchObject({ status: 'review', score: 30 });
    expect(r.send).toEqual([ANTIBIOTICS.reviewBody]);
  });

  it('a choice leading to an earlier question: the same', () => {
    const onQ2 = run(['1']).conversation;
    const back: Rules = {
      ...RULES,
      flow: {
        ...ANTIBIOTICS,
        questions: ANTIBIOTICS.questions.map((q) =>
          q.id === Q2 ? { ...q, choices: q.choices.map((c) => ({ ...c, nextQuestionId: Q1 })) } : q
        ),
      },
    };
    expect(step(onQ2, said('yes'), back).conversation.status).toBe('review');
  });
});

describe('any flow, not this one: five questions, added as data', () => {
  const question = (n: number, last: boolean) => ({
    id: 100 + n,
    key: `q${n}`,
    position: n,
    body: `Question ${n}? Reply 1 or 2.`,
    clarifyBody: `Sorry, question ${n}: reply 1 or 2.`,
    heading: `Answer ${n}`,
    choices: [
      { choice: '1', label: 'A', words: ['a'], points: 5, reply: null, nextQuestionId: last ? null : 101 + n, ending: last ? ('completed' as const) : null },
      { choice: '2', label: 'B', words: ['b'], points: 1, reply: `Noted ${n}.`, nextQuestionId: last ? null : 101 + n, ending: last ? ('completed' as const) : null },
    ],
  });
  const FIVE: Flow = {
    id: 9,
    key: 'five',
    respondedPoints: 10,
    completedPoints: 10,
    reviewBody: 'Someone will be in touch.',
    questions: [1, 2, 3, 4, 5].map((n) => question(n, n === 5)),
  };
  const rules = { ...RULES, flow: FIVE };
  const start = fresh({ currentQuestionId: 101 });

  it('asks all five and finishes on the fifth', () => {
    const fourth = run(['1', '1', '1', '1'], start, rules);
    expect(fourth.conversation).toMatchObject({ status: 'open', step: 5, currentQuestionId: 105 });
    const fifth = step(fourth.conversation, said('a'), rules);
    expect(fifth.conversation).toMatchObject({ status: 'completed', endOutcome: 'completed', score: 10 + 5 * 5 + 10 });
  });

  it('a choice with no reply sends the next question alone; one with a reply sends both', () => {
    expect(step(start, said('1'), rules).send).toEqual(['Question 2? Reply 1 or 2.']);
    expect(step(start, said('b'), rules).send).toEqual(['Noted 1.', 'Question 2? Reply 1 or 2.']);
  });
});
