import { matchAnswer } from './answers';
import {
  step,
  tierFor,
  type Conversation,
  type Rules,
  type ScoringRule,
} from './state-machine';

/** The seeded rules from 001_init.sql, so the numbers here match production. */
const SCORING: ScoringRule[] = [
  { code: 'responded', question: 0, choice: null, points: 10 },
  { code: 'completed', question: 0, choice: null, points: 10 },
  { code: 'q1_1', question: 1, choice: '1', points: 5 },
  { code: 'q1_2', question: 1, choice: '2', points: 10 },
  { code: 'q1_3', question: 1, choice: '3', points: 15 },
  { code: 'q2_1', question: 2, choice: '1', points: 30 },
  { code: 'q2_2', question: 2, choice: '2', points: 20 },
  { code: 'q2_3', question: 2, choice: '3', points: 5 },
  { code: 'q3_1', question: 3, choice: '1', points: 35 },
  { code: 'q3_2', question: 3, choice: '2', points: 25 },
  { code: 'q3_3', question: 3, choice: '3', points: 10 },
];

const RULES: Rules = {
  scoring: SCORING,
  tiers: [
    { name: 'HOT', minScore: 75, maxScore: 100 },
    { name: 'WARM', minScore: 45, maxScore: 74 },
    { name: 'LOW', minScore: 1, maxScore: 44 },
  ],
  maxInvalidBeforeReview: 1,
};

function fresh(overrides: Partial<Conversation> = {}): Conversation {
  return {
    status: 'open',
    step: 1,
    q1: null,
    q2: null,
    q3: null,
    invalidCount: 0,
    score: 0,
    tier: null,
    ...overrides,
  };
}

const answer = (text: string) => ({ text, optOut: false });

/** Walks a conversation through several replies, as a real lead would. */
function run(texts: string[], from: Conversation = fresh()) {
  let conversation = from;
  let last = step(conversation, answer(texts[0]), RULES);
  conversation = last.conversation;
  for (const text of texts.slice(1)) {
    last = step(conversation, answer(text), RULES);
    conversation = last.conversation;
  }
  return last;
}

describe('matchAnswer', () => {
  it('accepts the bare numbers at every step', () => {
    for (const s of [1, 2, 3]) {
      expect(matchAnswer('1', s)).toBe('1');
      expect(matchAnswer('2', s)).toBe('2');
      expect(matchAnswer('3', s)).toBe('3');
    }
  });

  it('accepts the words for each question', () => {
    expect(matchAnswer('supplements', 1)).toBe('1');
    expect(matchAnswer('telehealth', 1)).toBe('2');
    expect(matchAnswer('both', 1)).toBe('3');
    expect(matchAnswer('today', 2)).toBe('1');
    expect(matchAnswer('this week', 2)).toBe('2');
    expect(matchAnswer('researching', 2)).toBe('3');
    expect(matchAnswer('call me', 3)).toBe('1');
    expect(matchAnswer('text me', 3)).toBe('2');
    expect(matchAnswer('later', 3)).toBe('3');
  });

  it('forgives punctuation, case and a leading Option or #', () => {
    expect(matchAnswer('1.', 1)).toBe('1');
    expect(matchAnswer('Option 2', 1)).toBe('2');
    expect(matchAnswer('#3', 1)).toBe('3');
    expect(matchAnswer('Supplements!', 1)).toBe('1');
    expect(matchAnswer('  TODAY  ', 2)).toBe('1');
  });

  it('rejects a valid word inside a sentence', () => {
    // The whole message must be the answer, or "not today" would read as today.
    expect(matchAnswer('not today', 2)).toBeNull();
    expect(matchAnswer("I don't want supplements", 1)).toBeNull();
    expect(matchAnswer('both today', 2)).toBeNull();
    expect(matchAnswer('maybe later this week', 2)).toBeNull();
  });

  it('rejects a word belonging to a different question', () => {
    expect(matchAnswer('supplements', 2)).toBeNull();
    expect(matchAnswer('today', 1)).toBeNull();
  });

  it('rejects empty and unparseable replies', () => {
    expect(matchAnswer('', 1)).toBeNull();
    expect(matchAnswer('   ', 1)).toBeNull();
    expect(matchAnswer('4', 1)).toBeNull();
    expect(matchAnswer('yes please', 1)).toBeNull();
  });
});

describe('tierFor', () => {
  it('maps scores to their band, and 0 to no tier', () => {
    expect(tierFor(RULES, 0)).toBeNull();
    expect(tierFor(RULES, 10)).toBe('LOW');
    expect(tierFor(RULES, 44)).toBe('LOW');
    expect(tierFor(RULES, 45)).toBe('WARM');
    expect(tierFor(RULES, 74)).toBe('WARM');
    expect(tierFor(RULES, 75)).toBe('HOT');
    expect(tierFor(RULES, 100)).toBe('HOT');
  });
});

describe('the happy path', () => {
  it('3, 1, 1 completes at 100 and HOT', () => {
    const result = run(['3', '1', '1']);
    expect(result.conversation.status).toBe('completed');
    expect(result.conversation.score).toBe(100);
    expect(result.conversation.tier).toBe('HOT');
    expect(result.send).toBe('message_thanks');
  });

  it('sends each next question in turn', () => {
    let c = fresh();
    let r = step(c, answer('3'), RULES);
    expect(r.send).toBe('question_2');
    expect(r.conversation.step).toBe(2);
    expect(r.conversation.q1).toBe('3');

    r = step(r.conversation, answer('1'), RULES);
    expect(r.send).toBe('question_3');
    expect(r.conversation.step).toBe(3);
    expect(r.conversation.q2).toBe('1');

    r = step(r.conversation, answer('1'), RULES);
    expect(r.send).toBe('message_thanks');
    expect(r.conversation.q3).toBe('1');
  });

  it('accepts words throughout', () => {
    const result = run(['both', 'today', 'call me']);
    expect(result.conversation.status).toBe('completed');
    expect(result.conversation.score).toBe(100);
  });
});

describe('scoring across every combination', () => {
  it('lands each of the 27 completions in the tier its score implies', () => {
    const seen: Record<string, number> = {};

    for (const q1 of ['1', '2', '3']) {
      for (const q2 of ['1', '2', '3']) {
        for (const q3 of ['1', '2', '3']) {
          const result = run([q1, q2, q3]);
          const { score, tier } = result.conversation;

          // 10 responded + 10 completed + the three answers.
          const expected =
            20 +
            SCORING.find((r) => r.code === `q1_${q1}`)!.points +
            SCORING.find((r) => r.code === `q2_${q2}`)!.points +
            SCORING.find((r) => r.code === `q3_${q3}`)!.points;

          expect(score).toBe(expected);
          expect(tier).toBe(tierFor(RULES, expected));
          seen[tier!] = (seen[tier!] ?? 0) + 1;
        }
      }
    }

    // The distribution SCHEMA.md documents: LOW is reachable by exactly one
    // completion, which is why partial conversations are what fill that band.
    expect(seen).toEqual({ HOT: 13, WARM: 13, LOW: 1 });
  });

  it('cannot score a completion below 40', () => {
    const worst = run(['1', '3', '3']);
    expect(worst.conversation.score).toBe(40);
    expect(worst.conversation.tier).toBe('LOW');
  });

  it('scores a lead who answers question 1 and stops', () => {
    // 10 for responding plus the answer: 15, 20 or 25, all LOW.
    expect(run(['1']).conversation.score).toBe(15);
    expect(run(['2']).conversation.score).toBe(20);
    expect(run(['3']).conversation.score).toBe(25);
    expect(run(['3']).conversation.tier).toBe('LOW');
  });

  it('awards responded only once, however many replies arrive', () => {
    const r1 = step(fresh(), answer('nonsense'), RULES);
    expect(r1.conversation.score).toBe(10);

    const r2 = step(r1.conversation, answer('3'), RULES);
    // 10 already banked, plus 15 for the answer - not another 10.
    expect(r2.conversation.score).toBe(25);
  });

  it('gives an unclear first reply the responded points', () => {
    const result = step(fresh(), answer('what is this'), RULES);
    expect(result.conversation.score).toBe(10);
    expect(result.conversation.tier).toBe('LOW');
  });
});

describe('unclear replies', () => {
  it('clarifies once, keeping the same step', () => {
    const result = step(fresh(), answer('what?'), RULES);
    expect(result.send).toBe('message_clarify_1');
    expect(result.conversation.step).toBe(1);
    expect(result.conversation.invalidCount).toBe(1);
    expect(result.conversation.status).toBe('open');
  });

  it('sends the clarification for the current question', () => {
    const atTwo = fresh({ step: 2, q1: '3', score: 25 });
    expect(step(atTwo, answer('huh'), RULES).send).toBe('message_clarify_2');

    const atThree = fresh({ step: 3, q1: '3', q2: '1', score: 55 });
    expect(step(atThree, answer('huh'), RULES).send).toBe('message_clarify_3');
  });

  it('moves to review on the second unclear reply', () => {
    const result = run(['what?', 'still what?']);
    expect(result.conversation.status).toBe('review');
    expect(result.send).toBe('message_review');
  });

  it('resets the count on a valid answer, so a later fumble clarifies again', () => {
    // Unclear on Q1, then answer it, then unclear on Q2: a clarification, not
    // review, because answering cleared the count.
    const result = run(['what?', '3', 'huh?']);
    expect(result.conversation.status).toBe('open');
    expect(result.send).toBe('message_clarify_2');
    expect(result.conversation.invalidCount).toBe(1);
  });

  it('keeps the score it earned when it reaches review', () => {
    const result = run(['what?', 'still what?']);
    expect(result.conversation.score).toBe(10);
    expect(result.conversation.tier).toBe('LOW');
  });
});

describe('opt-out', () => {
  it('suppresses an open conversation, blocks the number, sends nothing', () => {
    for (const s of [1, 2, 3]) {
      const result = step(fresh({ step: s }), { text: 'STOP', optOut: true }, RULES);
      expect(result.conversation.status).toBe('suppressed');
      expect(result.blockNumber).toBe(true);
      expect(result.send).toBeNull();
    }
  });

  it('blocks the number but leaves a completed conversation completed', () => {
    const done = fresh({ status: 'completed', step: 3, q1: '3', q2: '1', q3: '1', score: 100, tier: 'HOT' });
    const result = step(done, { text: 'STOP', optOut: true }, RULES);
    expect(result.conversation.status).toBe('completed');
    expect(result.conversation.score).toBe(100);
    expect(result.blockNumber).toBe(true);
    expect(result.send).toBeNull();
  });

  it('wins over a reply that would otherwise be a valid answer', () => {
    const result = step(fresh(), { text: '1', optOut: true }, RULES);
    expect(result.conversation.status).toBe('suppressed');
    expect(result.conversation.q1).toBeNull();
    expect(result.blockNumber).toBe(true);
  });

  it('earns no points', () => {
    const result = step(fresh(), { text: 'STOP', optOut: true }, RULES);
    expect(result.conversation.score).toBe(0);
  });
});

describe('a conversation that is not open', () => {
  it.each(['completed', 'review', 'expired', 'suppressed'] as const)(
    'ignores a reply to a %s conversation',
    (status) => {
      const before = fresh({ status, step: 3, q1: '3', score: 40, tier: 'LOW' });
      const result = step(before, answer('1'), RULES);

      expect(result.conversation).toEqual(before);
      expect(result.send).toBeNull();
      expect(result.blockNumber).toBe(false);
    }
  );

  it('leaves an expired conversation expired, so the caller only flags the lead', () => {
    const expired = fresh({ status: 'expired', step: 2, q1: '3', score: 25, tier: 'LOW' });
    const result = step(expired, answer('anything'), RULES);
    expect(result.conversation.status).toBe('expired');
    expect(result.send).toBeNull();
  });
});

describe('an agent has taken the conversation over - rule 2b', () => {
  const TOOK_OVER = new Date('2026-09-26T10:00:00.000Z');

  it('asks no further question, whatever the lead replies', () => {
    const before = fresh({ step: 2, q1: '3', score: 25, tier: 'LOW', agentTookOverAt: TOOK_OVER });
    const result = step(before, answer('1'), RULES);

    // The lead is answering the agent, not us.
    expect(result.send).toBeNull();
    expect(result.conversation).toEqual(before);
  });

  it('scores nothing, even for a valid answer', () => {
    const before = fresh({ step: 2, q1: '3', score: 25, tier: 'LOW', agentTookOverAt: TOOK_OVER });
    const result = step(before, answer('1'), RULES);

    // 25 + q2_1 30 would be 55 without the rule; responded was earned already.
    expect(result.conversation.score).toBe(25);
    expect(result.conversation.q2).toBeNull();
    expect(result.conversation.step).toBe(2);
  });

  it('keeps the score and tier the lead had earned', () => {
    const before = fresh({ step: 3, q1: '3', q2: '1', score: 55, tier: 'WARM', agentTookOverAt: TOOK_OVER });
    const result = step(before, answer('2'), RULES);

    expect(result.conversation.score).toBe(55);
    expect(result.conversation.tier).toBe('WARM');
    // Never reaches the completion award.
    expect(result.conversation.status).toBe('open');
  });

  it('sends no clarification for an unclear reply either', () => {
    const before = fresh({ step: 1, agentTookOverAt: TOOK_OVER });
    const result = step(before, answer('what is this about?'), RULES);

    expect(result.send).toBeNull();
    expect(result.conversation.invalidCount).toBe(0);
    expect(result.conversation.status).toBe('open');
  });

  it('never sends the lead to review, however many unclear replies arrive', () => {
    const before = fresh({ step: 1, invalidCount: 5, agentTookOverAt: TOOK_OVER });
    const result = step(before, answer('???'), RULES);

    expect(result.conversation.status).toBe('open');
    expect(result.send).toBeNull();
  });

  it('still blocks the number on an opt-out', () => {
    const before = fresh({ step: 2, q1: '3', score: 25, agentTookOverAt: TOOK_OVER });
    const result = step(before, { text: 'STOP', optOut: true }, RULES);

    // Rule 1 is checked first and stays first: an opt-out can never depend on
    // whether an agent happened to text first.
    expect(result.blockNumber).toBe(true);
    expect(result.conversation.status).toBe('suppressed');
  });

  it('does nothing when the timestamp is absent', () => {
    // The ordinary path, to prove the rule is what changed the behaviour above.
    const before = fresh({ step: 2, q1: '3', score: 25, tier: 'LOW' });
    const result = step(before, answer('1'), RULES);

    expect(result.send).toBe('question_3');
    // 25 + q2_1 30. No responded award: q1 is already answered, so it was
    // earned on an earlier reply and is only ever given once.
    expect(result.conversation.score).toBe(55);
  });

  it.each([null, undefined])('treats %s as not taken over', (value) => {
    const before = fresh({ step: 1, agentTookOverAt: value });
    expect(step(before, answer('1'), RULES).send).toBe('question_2');
  });

  it('accepts the timestamp as the string a driver may return', () => {
    const before = fresh({ step: 1, agentTookOverAt: '2026-09-26T10:00:00.000Z' });
    expect(step(before, answer('1'), RULES).send).toBeNull();
  });
});

describe('admin-editable rules are honoured', () => {
  it('uses changed point values', () => {
    const doubled: Rules = {
      ...RULES,
      scoring: SCORING.map((r) => ({ ...r, points: r.points * 2 })),
    };
    const r = step(fresh(), answer('3'), doubled);
    expect(r.conversation.score).toBe(50); // 20 responded + 30 for q1_3

    const full = step(step(step(fresh(), answer('3'), doubled).conversation, answer('1'), doubled)
      .conversation, answer('1'), doubled);
    expect(full.conversation.score).toBe(200);
  });

  it('uses changed tier bands', () => {
    const strict: Rules = {
      ...RULES,
      tiers: [
        { name: 'HOT', minScore: 95, maxScore: 100 },
        { name: 'WARM', minScore: 60, maxScore: 94 },
        { name: 'LOW', minScore: 1, maxScore: 59 },
      ],
    };
    const result = run(['2', '2', '2'], fresh());
    expect(result.conversation.score).toBe(75);
    expect(tierFor(strict, 75)).toBe('WARM');
  });

  it('allows more than one clarification when the setting is raised', () => {
    const lenient: Rules = { ...RULES, maxInvalidBeforeReview: 2 };

    let r = step(fresh(), answer('what?'), lenient);
    expect(r.send).toBe('message_clarify_1');

    r = step(r.conversation, answer('still what?'), lenient);
    expect(r.send).toBe('message_clarify_1');
    expect(r.conversation.status).toBe('open');

    r = step(r.conversation, answer('no idea'), lenient);
    expect(r.conversation.status).toBe('review');
  });

  it('treats a missing rule as zero rather than failing', () => {
    const empty: Rules = { ...RULES, scoring: [] };
    const result = step(fresh(), answer('3'), empty);
    expect(result.conversation.score).toBe(0);
    expect(result.conversation.tier).toBeNull();
    expect(result.conversation.q1).toBe('3');
  });
});

describe('purity', () => {
  it('does not mutate the conversation it is given', () => {
    const before = fresh();
    const snapshot = { ...before };
    step(before, answer('3'), RULES);
    expect(before).toEqual(snapshot);
  });
});
