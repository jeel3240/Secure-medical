/**
 * What the automated call does next - T8, docs/AUTO-CALLS.md. Every path of
 * the script, on the script itself (the fixture the live check holds to the
 * database).
 */
import type { SpokenMatch } from './answers';
import {
  afterAnswer,
  answerRecord,
  firstAsk,
  handleAnswer,
  MAX_RUNG_AT_ONCE,
  holdGoesOn,
  pickOffer,
  placeLine,
  planAfterHolder,
  planNobodyTook,
  planTransfer,
  rangOut,
  splitForListening,
  type CallChoice,
  type CallScript,
} from './call-script';
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
      say: ["Sorry, I did not catch that. Press 1 for yes, 2 for no, or 9 to stop these calls."],
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
      say: ["Okay, we will not call you again. Goodbye."],
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

describe('one answer on a live call - handleAnswer (T13)', () => {
  const answer = (stepId: number, attempt: 1 | 2, match: SpokenMatch<CallChoice>, hungUp = false) =>
    handleAnswer(SCRIPT, stepId, attempt, match, hungUp);

  it('yes to the offer: kept, and handed on as a transfer - who rings is planned against who is free (T15a)', () => {
    expect(answer(OFFER_STEP, 1, pick(OFFER, 'Yes'))).toEqual({
      answer: { result: 'choice', choiceKey: '1', choiceLabel: 'Yes' },
      result: null,
      blockNumber: false,
      sendLink: false,
      brokenScript: false,
      next: { kind: 'transfer', say: ['Great, connecting you with a live agent now. Please hold.'] },
    });
  });

  it('no to the offer: kept, and the link question asked - no result yet', () => {
    const outcome = answer(OFFER_STEP, 1, pick(OFFER, 'No'));
    expect(outcome).toMatchObject({ answer: { choiceLabel: 'No' }, result: null, next: { kind: 'ask', step: LINK } });
  });

  it('yes to the link: link_sent, and the link to be texted; no: not_interested', () => {
    expect(answer(LINK_STEP, 1, pick(LINK, 'Yes'))).toMatchObject({ result: 'link_sent', sendLink: true, next: { kind: 'end' } });
    expect(answer(LINK_STEP, 1, pick(LINK, 'No'))).toMatchObject({ result: 'not_interested', sendLink: false });
  });

  it('stop: kept as opt_out, the number to be blocked, and the call ended', () => {
    expect(answer(LINK_STEP, 2, { result: 'opt_out' })).toMatchObject({
      answer: { result: 'opt_out', choiceKey: null },
      result: 'opted_out',
      blockNumber: true,
      next: { kind: 'end', say: ["Okay, we will not call you again. Goodbye."] },
    });
  });

  it('silence: kept, asked again for keys; the second time, no_response', () => {
    expect(answer(OFFER_STEP, 1, { result: 'silence' })).toMatchObject({
      answer: { result: 'silence' },
      result: null,
      next: { kind: 'ask', attempt: 2 },
    });
    expect(answer(OFFER_STEP, 2, { result: 'silence' })).toMatchObject({ result: 'no_response', next: { kind: 'end' } });
  });

  describe('when the lead has hung up - Twilio still asks (found on the first real call, T12)', () => {
    it('with nothing said: nothing kept at all - a hang-up, never silence', () => {
      expect(answer(OFFER_STEP, 1, { result: 'silence' }, true)).toEqual({
        answer: null,
        result: null,
        blockNumber: false,
        sendLink: false,
        brokenScript: false,
        next: null,
      });
      expect(answer(OFFER_STEP, 2, { result: 'silence' }, true).result).toBeNull();
    });

    it('a stop said as they left still blocks, and a yes to the link is still texted', () => {
      expect(answer(OFFER_STEP, 1, { result: 'opt_out' }, true)).toMatchObject({ result: 'opted_out', blockNumber: true, next: null });
      expect(answer(LINK_STEP, 1, pick(LINK, 'Yes'), true)).toMatchObject({ result: 'link_sent', sendLink: true, next: null });
    });

    it('but nothing that needs them on the line: no next question, no transfer, no no_response', () => {
      expect(answer(OFFER_STEP, 1, pick(OFFER, 'No'), true)).toMatchObject({ answer: { choiceLabel: 'No' }, result: null, next: null });
      expect(answer(OFFER_STEP, 1, pick(OFFER, 'Yes'), true)).toMatchObject({ answer: { choiceLabel: 'Yes' }, result: null, next: null });
      expect(answer(OFFER_STEP, 2, { result: 'unclear' }, true)).toMatchObject({ answer: { result: 'unclear' }, result: null, next: null });
    });
  });

  it('an answer to a step this script does not have: not kept, ended politely, and flagged as our mistake', () => {
    expect(answer(999, 1, pick(OFFER, 'Yes'))).toMatchObject({
      answer: null,
      result: 'no_response',
      brokenScript: true,
      next: { kind: 'end' },
    });
  });
});

describe('an asking, split for listening - splitForListening (T13)', () => {
  it('the opening: greeting and offer first, then the question alone', () => {
    expect(splitForListening([OFFER.body])).toEqual({
      leadIn: ["Hi, this is Seri calling from eDrugstore. Today we're offering 25% off antibiotics."],
      question: 'Are you interested in ordering?',
    });
  });

  it('a reply then the next question: the reply first, the question alone', () => {
    expect(splitForListening(["No problem - I'll just ask one more quick thing.", LINK.body])).toEqual({
      leadIn: ["No problem - I'll just ask one more quick thing."],
      question: 'Can we send you a link to see all our medication at discount prices?',
    });
  });

  it('the repeat: the apology first, the keys to press listened for', () => {
    expect(splitForListening([OFFER.repeatBody])).toEqual({
      leadIn: ["Sorry, I did not catch that."],
      question: 'Press 1 for yes, 2 for no, or 9 to stop these calls.',
    });
  });

  it('one sentence is all question; nothing is nothing', () => {
    expect(splitForListening(['Are you there?'])).toEqual({ leadIn: [], question: 'Are you there?' });
    expect(splitForListening([])).toEqual({ leadIn: [], question: '' });
  });
});

describe('a yes to a transfer, planned against who is free - planTransfer (T15a, T15b)', () => {
  const transfer = { kind: 'transfer' as const, say: ['Great, connecting you with a live agent now. Please hold.'] };
  const plan = (free: number[], holder: number | null = null, machine = false, onCall = false) =>
    planTransfer(SCRIPT, transfer, { free, machine, holder, onCall });

  it('people free: the line, then all of them rung together', () => {
    expect(plan([16, 21])).toEqual({
      kind: 'ring',
      say: ['Great, connecting you with a live agent now. Please hold.'],
      agentIds: [16, 21],
      holderFirst: false,
    });
  });

  it('never more than Twilio rings at once', () => {
    const free = Array.from({ length: 14 }, (_, i) => i + 1);
    const ring = plan(free);
    expect(ring.kind === 'ring' && ring.agentIds).toEqual(free.slice(0, MAX_RUNG_AT_ONCE));
    expect(MAX_RUNG_AT_ONCE).toBe(10);
  });

  it('nobody free: the line, then the busy line - transfer_missed, so an agent calls back', () => {
    expect(plan([])).toEqual({
      kind: 'end',
      say: ['Great, connecting you with a live agent now. Please hold.', SCRIPT.busyBody],
      result: 'transfer_missed',
    });
  });

  it('a machine on the line is never put through - a voicemail greeting is not a yes', () => {
    expect(plan([16], 16, true)).toEqual({ kind: 'end', say: [SCRIPT.noResponseBody], result: 'no_response' });
    expect(plan([], null, true, true)).toEqual({ kind: 'end', say: [SCRIPT.noResponseBody], result: 'no_response' });
  });

  it('nobody free, but someone who takes transfers on a call: the line, then on hold (T16)', () => {
    expect(plan([], null, false, true)).toEqual({
      kind: 'hold',
      say: ['Great, connecting you with a live agent now. Please hold.', SCRIPT.holdBody],
    });
  });

  describe('the lead\'s own agent first (T15b)', () => {
    it('free: the line, then they ring alone, first', () => {
      expect(plan([16, 21], 21)).toEqual({
        kind: 'ring',
        say: ['Great, connecting you with a live agent now. Please hold.'],
        agentIds: [21],
        holderFirst: true,
      });
    });

    it('free, and the only one: still alone first', () => {
      expect(plan([21], 21)).toMatchObject({ agentIds: [21], holderFirst: true });
    });

    it('not free - on a call, away, or the switch off: everyone free at once, not waited for', () => {
      expect(plan([16, 30], 21)).toMatchObject({ agentIds: [16, 30], holderFirst: false });
      expect(plan([], 21)).toMatchObject({ kind: 'end', result: 'transfer_missed' });
    });

    it('free beyond the first ten: still rung first', () => {
      const free = Array.from({ length: 14 }, (_, i) => i + 1);
      expect(plan(free, 14)).toMatchObject({ agentIds: [14], holderFirst: true });
    });
  });
});

describe('the lead\'s own agent let it ring out - planAfterHolder (T15b)', () => {
  it('everyone else free, together, at once - nothing said: the lead has been listening to it ring', () => {
    expect(planAfterHolder(SCRIPT, { free: [16, 21, 30], holder: 21, onCall: false })).toEqual({
      kind: 'ring',
      say: [],
      agentIds: [16, 30],
      holderFirst: false,
    });
  });

  it('never more than Twilio rings at once', () => {
    const free = Array.from({ length: 14 }, (_, i) => i + 1);
    const ring = planAfterHolder(SCRIPT, { free, holder: 1, onCall: false });
    expect(ring.kind === 'ring' && ring.agentIds).toEqual(free.slice(1, 1 + MAX_RUNG_AT_ONCE));
  });

  it('nobody else free - or nobody at all: the busy line, transfer_missed', () => {
    const busy = { kind: 'end', say: [SCRIPT.busyBody], result: 'transfer_missed' };
    expect(planAfterHolder(SCRIPT, { free: [21], holder: 21, onCall: false })).toEqual(busy);
    expect(planAfterHolder(SCRIPT, { free: [], holder: 21, onCall: false })).toEqual(busy);
  });

  it('nobody else free, but someone on a call: on hold (T16)', () => {
    expect(planAfterHolder(SCRIPT, { free: [21], holder: 21, onCall: true })).toEqual({ kind: 'hold', say: [SCRIPT.holdBody] });
  });
});

describe('who let a transfer ring out - rangOut (T15c)', () => {
  const ran = (dialStatus: string, rung: number[], rings: [number, string][] | null = null, hungUp = false) =>
    rangOut({ dialStatus, hungUp, rung, rings: rings && new Map(rings) });

  it('the lead\'s own agent, rung alone, and it ran out: they did', () => {
    expect(ran('no-answer', [21])).toEqual([21]);
  });

  it('several rung, nobody took it: those whose own ring ran out - not who declined', () => {
    expect(ran('no-answer', [16, 19, 30], [[16, 'no-answer'], [19, 'busy'], [30, 'no-answer']])).toEqual([16, 30]);
  });

  it('several rung, and how each ended is not known: nobody', () => {
    expect(ran('no-answer', [16, 19], null)).toEqual([]);
    expect(ran('no-answer', [16, 19], [])).toEqual([]);
  });

  it('taken, every ring declined, or it failed: nobody', () => {
    for (const status of ['completed', 'answered', 'busy', 'failed', 'canceled']) {
      expect(ran(status, [16, 19], [[16, 'no-answer'], [19, 'no-answer']])).toEqual([]);
    }
  });

  it('the lead hung up while it rang: nobody - it was not left to run out', () => {
    expect(ran('no-answer', [21], null, true)).toEqual([]);
    expect(ran('no-answer', [16, 19], [[16, 'no-answer'], [19, 'no-answer']], true)).toEqual([]);
  });
});

describe('the hold line (T16)', () => {
  it('nobody took it: on hold while someone is on a call, else the busy line', () => {
    expect(planNobodyTook(SCRIPT, { onCall: true })).toEqual({ kind: 'hold', say: [SCRIPT.holdBody] });
    expect(planNobodyTook(SCRIPT, { onCall: false })).toEqual({
      kind: 'end',
      say: [SCRIPT.busyBody],
      result: 'transfer_missed',
    });
    expect(planNobodyTook(SCRIPT, { say: ['Please hold.'], onCall: false })).toMatchObject({ say: ['Please hold.', SCRIPT.busyBody] });
  });

  it('waits on while someone may yet take them, and not past the safety stop', () => {
    expect(holdGoesOn({ waitedSeconds: 0, maxSeconds: 600, someoneComing: true })).toBe(true);
    expect(holdGoesOn({ waitedSeconds: 599, maxSeconds: 600, someoneComing: true })).toBe(true);
    expect(holdGoesOn({ waitedSeconds: 600, maxSeconds: 600, someoneComing: true })).toBe(false);
    expect(holdGoesOn({ waitedSeconds: 30, maxSeconds: 600, someoneComing: false })).toBe(false);
  });

  it('the place in line, in the script\'s words', () => {
    expect(placeLine(SCRIPT, 1)).toBe('You are next.');
    expect(placeLine(SCRIPT, 2)).toBe('You are number 2 in line.');
    expect(placeLine(SCRIPT, 11)).toBe('You are number 11 in line.');
  });
});

describe('who a lead on hold rings - pickOffer (T17)', () => {
  const lead = (callId: number, offeredTo: number[] = [], offerLive = false) => ({ callId, offeredTo, offerLive });

  it('the lead who has waited longest rings the first person free', () => {
    expect(pickOffer([lead(40), lead(41)], [16, 19])).toEqual({ callId: 40, agentId: 16 });
  });

  it('never someone this lead was offered to already - however that ended', () => {
    expect(pickOffer([lead(40, [16])], [16, 19])).toEqual({ callId: 40, agentId: 19 });
    expect(pickOffer([lead(40, [16, 19])], [16, 19])).toBeNull();
  });

  it('a lead already ringing someone is passed over for the next in line', () => {
    expect(pickOffer([lead(40, [16], true), lead(41)], [19])).toEqual({ callId: 41, agentId: 19 });
  });

  it('the next in line, when the first has had everyone free', () => {
    expect(pickOffer([lead(40, [19]), lead(41)], [19])).toEqual({ callId: 41, agentId: 19 });
  });

  it('only the person who has just come free, when one is named', () => {
    expect(pickOffer([lead(40)], [16, 19], 19)).toEqual({ callId: 40, agentId: 19 });
    expect(pickOffer([lead(40)], [16], 19)).toBeNull();
    expect(pickOffer([lead(40, [19])], [16, 19], 19)).toBeNull();
  });

  it('nobody waiting, or nobody free: nothing', () => {
    expect(pickOffer([], [16])).toBeNull();
    expect(pickOffer([lead(40)], [])).toBeNull();
  });
});
