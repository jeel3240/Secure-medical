/**
 * Understand (A28): the prompt, the answer's shape, reading it back, and the
 * fast path - without OpenAI. How well OpenAI labels is `npm run ai:eval:understand`.
 */
import { criticalPrecision, gradeUnderstand, loadUnderstandCases, type UnderstandCase } from './evals/understand-grade';
import { loadKnowledge } from './knowledge';
import { REAL_PERSON, UNCOVERED, type Act } from './policy';
import { actLabel, actLabels, fastPath, parseActs, understandFormat, understandMessages, understandSystem, UnderstandError } from './understand';

const knowledge = loadKnowledge();

describe('the labels', () => {
  it('the plain acts, a question for every approved answer and the two of our own, and the objections that are not already an act', () => {
    const labels = actLabels(knowledge);
    expect(labels).toContain('stop');
    expect(labels).toContain('machine');
    for (const a of knowledge.answers) expect(labels).toContain(`asks:${a.id}`);
    expect(labels).toContain(`asks:${UNCOVERED}`);
    expect(labels).toContain(`asks:${REAL_PERSON}`);
    expect(labels).toContain('objection:busy');
    expect(labels).not.toContain('objection:not_interested');
    expect(labels).not.toContain('objection:wrong_person');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('the answer may hold only those - strict', () => {
    const format = understandFormat(knowledge);
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.properties.acts.items.enum).toEqual(actLabels(knowledge));
  });

  it('every label in the labelled set is one OpenAI can write - a typo there would fail for ever', () => {
    const known = new Set([...actLabels(knowledge), 'not_interested:closed', 'not_interested:timing', 'not_interested:product']);
    for (const c of loadUnderstandCases()) {
      for (const label of [...c.want.flatMap((g) => g.split('|')), ...c.allow]) expect([c.id, label, known.has(label)]).toEqual([c.id, label, true]);
    }
  });
});

describe('the prompt', () => {
  it('the same first part on every turn, then the turn: what she said, what they said, and what came before', () => {
    const messages = understandMessages(knowledge, {
      said: 'How much is it?',
      seri: "Is that something you'd be interested in?",
      before: [{ who: 'lead', text: 'Yes.' }],
    });
    expect(messages[0]).toEqual({ role: 'system', content: understandSystem(knowledge) });
    expect(messages[1].content).toBe("Earlier:\nCaller: Yes.\n\nSeri just said: Is that something you'd be interested in?\n\nThe caller just said: How much is it?");
  });

  it('names every answer and objection it may label', () => {
    const system = understandSystem(knowledge);
    for (const a of knowledge.answers) expect(system).toContain(`- ${a.id}: `);
    expect(system).toContain('- busy: ');
    expect(system).not.toContain('- not_interested: No');
  });
});

describe('reading the answer back', () => {
  it('each label as its act - the reason with a no, the time with a call back, each once', () => {
    const acts = parseActs(
      JSON.stringify({
        acts: ['not_interested', 'asks:price', 'objection:busy', 'wants_callback', 'asks:price'],
        reason: 'timing',
        time: { day: 'Tomorrow', hour: 2, minute: null, ampm: 'pm' },
      }),
      knowledge
    );
    expect(acts).toEqual([
      { act: 'not_interested', reason: 'timing' },
      { act: 'asks', topic: 'price' },
      { act: 'objection', id: 'busy' },
      { act: 'wants_callback', time: { day: 'tomorrow', hour: 2, minute: null, ampm: 'pm' } },
    ]);
  });

  it('a call back with no day and no hour has no time', () => {
    expect(parseActs(JSON.stringify({ acts: ['wants_callback'], reason: null, time: { day: ' ', hour: null, minute: 5, ampm: null } }), knowledge)).toEqual([
      { act: 'wants_callback', time: null },
    ]);
  });

  it('anything it does not know is an error, never a guess', () => {
    expect(() => parseActs('not json', knowledge)).toThrow(UnderstandError);
    expect(() => parseActs('{"reason":null}', knowledge)).toThrow(UnderstandError);
    expect(() => parseActs('{"acts":["asks:pets"],"reason":null,"time":null}', knowledge)).toThrow(UnderstandError);
  });

  it('an act written back as its label', () => {
    const acts: Act[] = [
      { act: 'asks', topic: 'price' },
      { act: 'objection', id: 'scam' },
      { act: 'not_interested', reason: 'product' },
      { act: 'not_interested', reason: null },
      { act: 'stop' },
    ];
    expect(acts.map(actLabel)).toEqual(['asks:price', 'objection:scam', 'not_interested:product', 'not_interested', 'stop']);
  });
});

describe('the fast path - a bare yes or no to a yes-or-no question, without OpenAI', () => {
  it.each([
    ['Yes.', 'interest', [{ act: 'agrees' }]],
    ['Yeah', 'offer_connect', [{ act: 'agrees' }]],
    ['Uh, yes please.', 'confirm', [{ act: 'agrees' }]],
    ["Yes, ma'am.", 'offer_link', [{ act: 'agrees' }]],
    ['Yes.', 'identity', [{ act: 'confirm_identity' }]],
    ['No.', 'interest', [{ act: 'declines' }]],
    ['No thank you.', 'offer_callback', [{ act: 'declines' }]],
    ['Nope', 'anything_else', [{ act: 'declines' }]],
  ] as const)('%j to %s', (said, open, acts) => {
    expect(fastPath(said, open)).toEqual(acts);
  });

  it.each([
    ['Okay.', 'interest'], // never a yes (call 99)
    ['Yes, but call me tomorrow.', 'interest'],
    ['No. Can you call me tomorrow at two?', 'offer_connect'],
    ['Yes.', 'why'],
    ['Yes.', 'time'],
    ['Yes.', null],
  ] as const)('%j to %s - asked of OpenAI', (said, open) => {
    expect(fastPath(said, open)).toBeNull();
  });
});

describe('marking an answer (evals/understand-grade.ts)', () => {
  const c = (over: Partial<UnderstandCase>): UnderstandCase => ({ id: 'x', source: 'test', before: [], seri: '', lead: '', want: [], allow: [], ...over });

  it('every group found, nothing else - "a|b" either', () => {
    expect(gradeUnderstand(c({ want: ['asks:scam|objection:scam'] }), [{ act: 'objection', id: 'scam' }]).pass).toBe(true);
    expect(gradeUnderstand(c({ want: ['asks:price'] }), [{ act: 'asks', topic: 'shipping' }]).problems).toEqual(['missing asks:price', 'not wanted: asks:shipping']);
  });

  it('"not_interested" takes any reason; a reason named takes only that one', () => {
    expect(gradeUnderstand(c({ want: ['not_interested'] }), [{ act: 'not_interested', reason: 'closed' }]).pass).toBe(true);
    expect(gradeUnderstand(c({ want: ['not_interested:timing'] }), [{ act: 'not_interested', reason: 'closed' }]).pass).toBe(false);
  });

  it('saying it is them is never wrong; "other" only beside what was wanted', () => {
    expect(gradeUnderstand(c({ want: ['asks:price'] }), [{ act: 'confirm_identity' }, { act: 'asks', topic: 'price' }, { act: 'other' }]).pass).toBe(true);
    expect(gradeUnderstand(c({ want: ['asks:price'] }), [{ act: 'other' }]).pass).toBe(false);
  });

  it('a call-back time must have the parts named', () => {
    const want = c({ want: ['wants_callback'], time: { day: 'tomorrow', hour: 2 } });
    expect(gradeUnderstand(want, [{ act: 'wants_callback', time: { day: 'tomorrow', hour: 2, minute: null, ampm: 'pm' } }]).pass).toBe(true);
    expect(gradeUnderstand(want, [{ act: 'wants_callback', time: { day: 'tomorrow', hour: 3, minute: null, ampm: null } }]).problems).toEqual(['time hour: 3, wanted 2']);
  });

  it('how often the acts that end or move a call were right when read', () => {
    const results = [
      { c: c({ want: ['stop'] }), labels: ['stop'] },
      { c: c({ want: ['asks:medical_question'] }), labels: ['stop'] },
      { c: c({ want: ['wants_person'] }), labels: ['wants_person'] },
    ];
    expect(criticalPrecision(results)).toEqual({ stop: { read: 2, right: 1 }, wrong_person: { read: 0, right: 0 }, wants_person: { read: 1, right: 1 } });
  });
});
