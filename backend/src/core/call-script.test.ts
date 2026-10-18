/**
 * What the automated call does next - T8, docs/AUTO-CALLS.md. Every path of
 * the script, on the script itself (the fixture the live check holds to the
 * database).
 */
import type { SpokenMatch } from './answers';
import { afterAnswer, answerRecord, firstAsk, type CallChoice, type CallScript } from './call-script';
import { ANTIBIOTICS_CALL as SCRIPT, LINK_STEP, OFFER_STEP } from './call-script-fixtures';

const [OFFER, LINK] = SCRIPT.steps;
const pick = (step: typeof OFFER, label: string): SpokenMatch<CallChoice> => ({
  result: 'choice',
  choice: step.choices.find((c) => c.label === label)!,
});

describe('when the lead picks up', () => {
  it('the first step is asked, in its own words', () => {
    expect(firstAsk(SCRIPT)).toEqual({ kind: 'ask', step: OFFER, attempt: 1, say: [OFFER.body] });
  });
});

describe('the offer', () => {
  it('yes: the line, then a transfer to a person', () => {
    expect(afterAnswer(SCRIPT, OFFER_STEP, 1, pick(OFFER, 'Yes'))).toEqual({
      kind: 'transfer',
      say: ['Great, connecting you with a live agent now. Please hold.'],
    });
  });

  it('no: the line, then the link question - said together', () => {
    expect(afterAnswer(SCRIPT, OFFER_STEP, 1, pick(OFFER, 'No'))).toEqual({
      kind: 'ask',
      step: LINK,
      attempt: 1,
      say: ["No problem - I'll just ask one more quick thing.", LINK.body],
    });
  });
});

describe('the link', () => {
  it('yes: the line, the call ends, and the link is to be texted', () => {
    expect(afterAnswer(SCRIPT, LINK_STEP, 1, pick(LINK, 'Yes'))).toEqual({
      kind: 'end',
      say: ["Perfect. Check your SMS. Thanks! You'll get the link shortly. Have a great day."],
      result: 'link_sent',
      sendLink: true,
    });
  });

  it('no: thanked, and ended as not interested', () => {
    expect(afterAnswer(SCRIPT, LINK_STEP, 1, pick(LINK, 'No'))).toEqual({
      kind: 'end',
      say: ['Thank you for your time. Have a great day.'],
      result: 'not_interested',
    });
  });
});

describe('not understood, or silence - repeat once, then end', () => {
  it.each(['unclear', 'silence'] as const)('%s the first time: the step again, with the repeat line asking for keys', (result) => {
    expect(afterAnswer(SCRIPT, OFFER_STEP, 1, { result })).toEqual({
      kind: 'ask',
      step: OFFER,
      attempt: 2,
      say: ["Sorry, I didn't catch that. Press 1 for yes, 2 for no, or 9 to stop these calls."],
    });
    expect(afterAnswer(SCRIPT, LINK_STEP, 1, { result })).toMatchObject({ kind: 'ask', step: LINK, attempt: 2 });
  });

  it.each(['unclear', 'silence'] as const)('%s the second time: thanked, and ended as no response', (result) => {
    expect(afterAnswer(SCRIPT, OFFER_STEP, 2, { result })).toEqual({
      kind: 'end',
      say: ['Thank you for your time. Have a great day.'],
      result: 'no_response',
    });
  });

  it('an answer on the second asking counts like one on the first', () => {
    expect(afterAnswer(SCRIPT, OFFER_STEP, 2, pick(OFFER, 'Yes'))).toMatchObject({ kind: 'transfer' });
    expect(afterAnswer(SCRIPT, OFFER_STEP, 2, pick(OFFER, 'No'))).toMatchObject({ kind: 'ask', step: LINK, attempt: 1 });
  });
});

describe('stop', () => {
  it.each([
    [OFFER_STEP, 1],
    [OFFER_STEP, 2],
    [LINK_STEP, 1],
    [LINK_STEP, 2],
  ] as const)('on step %i, attempt %i: ends the call and blocks the number', (stepId, attempt) => {
    expect(afterAnswer(SCRIPT, stepId, attempt, { result: 'opt_out' })).toEqual({
      kind: 'end',
      say: ["Okay, we won't call you again. Goodbye."],
      result: 'opted_out',
      blockNumber: true,
    });
  });
});

describe('a script that leads nowhere it may - ended politely, never a loop', () => {
  const broken = (change: (s: CallScript) => CallScript) => change(structuredClone(SCRIPT) as CallScript);
  const polite = { kind: 'end', say: ['Thank you for your time. Have a great day.'], result: 'no_response', brokenScript: true };

  it('an answer to a step the script does not have', () => {
    expect(afterAnswer(SCRIPT, 999, 1, pick(OFFER, 'Yes'))).toEqual(polite);
  });

  it('a choice leading to a step that is not there', () => {
    const script = broken((s) => ({ ...s, steps: [s.steps[0]] }));
    expect(afterAnswer(script, OFFER_STEP, 1, pick(script.steps[0], 'No'))).toEqual(polite);
  });

  it('a choice leading back to an earlier step - which could loop for ever', () => {
    const script = broken((s) => {
      const [offer, link] = s.steps;
      const back = { ...link.choices[1], ending: null, nextStepId: offer.id };
      return { ...s, steps: [offer, { ...link, choices: [link.choices[0], back] }] };
    });
    expect(afterAnswer(script, LINK_STEP, 1, pick(script.steps[1], 'No'))).toEqual(polite);
  });

  it('a script with no steps at all', () => {
    expect(firstAsk({ ...SCRIPT, steps: [] })).toEqual(polite);
  });
});

describe('the answer as it is kept', () => {
  it('a choice keeps its key and its label as they are now', () => {
    expect(answerRecord(pick(OFFER, 'No'))).toEqual({ result: 'choice', choiceKey: '2', choiceLabel: 'No' });
  });

  it.each(['unclear', 'silence', 'opt_out'] as const)('%s keeps no choice', (result) => {
    expect(answerRecord({ result })).toEqual({ result, choiceKey: null, choiceLabel: null });
  });
});
