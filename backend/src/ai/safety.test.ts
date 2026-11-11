/**
 * Every sentence Seri is about to say, checked - A05, AI-AGENT.md section 6.
 */
import answersFile from './knowledge/answers.json';
import { ANTIBIOTICS_CALL } from '../core/call-script-fixtures';
import { spokenTime } from './callback-time';
import { welcomeGreeting } from './instructions';
import { loadKnowledge } from './knowledge';
import { checkSentence, SPECIALIST_LINE, type SafetyReason } from './safety';

const knowledge = loadKnowledge();
const sentences = (text: string) => text.split(/(?<=[.?!])\s+/).filter(Boolean);

describe('what is never said', () => {
  it.each<[string, SafetyReason]>([
    // A price, in any form.
    ['It\'s $39 for a month\'s supply.', 'price'],
    ['That one is 39 dollars.', 'price'],
    ['It\'s about forty bucks.', 'price'],
    ['It costs 39.99.', 'price'],
    ['The kit costs about 89, shipping included.', 'price'],
    ['It\'s 39.00 with free shipping.', 'price'],
    ['Prices start at 25 for the basic kit.', 'price'],
    ['It works out to 30 a month.', 'price'],
    // How to take it, or whether it is safe for them.
    ['You should take it twice a day.', 'advice'],
    ['The usual dosage is one tablet.', 'advice'],
    ['Take 500 mg twice a day.', 'advice'],
    ['Take it three times a day with food.', 'advice'],
    ['Take one pill every 12 hours.', 'advice'],
    ['Apply the cream before bed.', 'advice'],
    ['I\'d recommend taking amoxicillin.', 'advice'],
    ['I suggest you take the azithromycin.', 'advice'],
    ['You need to take the whole course.', 'advice'],
    ['You should stop taking it if you feel sick.', 'advice'],
    ['There are no side effects.', 'advice'],
    ['It\'s safe to take with your other medication.', 'advice'],
    // What they have.
    ['It sounds like you have a UTI.', 'diagnosis'],
    ['It sounds like you’ve got an infection.', 'diagnosis'],
    ['You probably have chlamydia.', 'diagnosis'],
    ['You might have a bacterial infection.', 'diagnosis'],
    ['You may have an STD, so a test kit is a good idea.', 'diagnosis'],
    ['That means you have an infection.', 'diagnosis'],
    ['You could be infected.', 'diagnosis'],
    // An offer we don't make.
    ['You can get 50% off.', 'discount'],
    ['We\'re offering 25% off today only.', 'discount'],
    ['Get 25 percent off your first order.', 'discount'],
    ['That\'s twenty-five percent off.', 'discount'],
    ['We can do up to 30% off.', 'discount'],
    ['You get fifty percent off today.', 'discount'],
    ['It\'s half off this week.', 'discount'],
    ['Up to 25% off, but only today.', 'discount'],
    ['This offer ends tonight, so act now.', 'discount'],
  ])('%j - %s', (sentence, reason) => {
    expect(checkSentence(sentence)).toEqual({ say: SPECIALIST_LINE, reason, found: expect.any(String) });
  });

  it('whatever the case or the apostrophes', () => {
    expect(checkSentence('TAKE IT TWICE A DAY.').reason).toBe('advice');
    expect(checkSentence('It sounds like you’ve got an infection.').reason).toBe('diagnosis');
  });

  it('names what it found, for the call\'s own record', () => {
    expect(checkSentence('That one is 39 dollars.').found).toBe('dollars');
    expect(checkSentence('You can get 50% off.').found).toBe('50%');
    expect(checkSentence('That\'s twenty-five percent off.').found).toBe('twenty-five percent');
  });
});

describe('what is said as written', () => {
  it.each([
    'You can get up to 25% off your first order.',
    'Up to 25 percent off your first order.',
    'It\'s up to twenty-five percent off your first order.',
    'Do you have a minute?',
    'Do you have any questions about how it works?',
    'You might have seen our text earlier.',
    'You may have seen our text about STI test kits.',
    'We carry Azithromycin 250 mg.',
    'We have Acyclovir 400 mg and Valacyclovir 500 mg.',
    'Prices depend on the medication and quantity.',
    'Great, connecting you now.',
    'So that\'s Thursday at 3 PM your time?',
    'That sounds great.',
    'Sounds like you\'re busy, so when is a better time?',
    'eDrugstore has been around for over 25 years.',
    'It takes 1 to 3 business days.',
    'Take your time.',
    'I\'d suggest a call back tomorrow, would that work?',
    'You should use the link I text you.',
    'Once it ships, you get a tracking number.',
    'I can take you off our list right now.',
  ])('%j', (sentence) => {
    expect(checkSentence(sentence)).toEqual({ say: sentence, reason: null, found: null });
  });
});

describe('every line in the knowledge files passes unchanged', () => {
  const lines: [string, string][] = [
    ...knowledge.answers.map((a): [string, string] => [`answer ${a.id}`, a.spoken]),
    // The answer not yet confirmed, as well as its fallback: it must pass once it is.
    ...answersFile.answers.map((a): [string, string] => [`answer ${a.id} as written`, a.answer]),
    ...knowledge.products.map((p): [string, string] => [`product ${p.slug}`, p.spokenLine]),
    ...knowledge.playbook.objections.map((o, i): [string, string] => [`objection ${i}`, o.example]),
    ...knowledge.playbook.closing.map((c): [string, string] => [`closing: ${c.situation}`, c.ask]),
  ];

  it('as many as the files hold', () => {
    expect(lines).toHaveLength(37 + 37 + 30 + 9 + 3);
  });

  it.each(lines)('%s', (_, line) => {
    expect(checkSentence(line).reason).toBeNull();
    for (const sentence of sentences(line)) expect(checkSentence(sentence)).toEqual({ say: sentence, reason: null, found: null });
  });
});

describe('and every line her instructions give her', () => {
  it.each([
    'This is Seri from eDrugstore. You signed up on one of our partner sites, and I\'m calling about our offer of up to 25% off your first order. Is that something you\'d be interested in?',
    'That\'s a great question. Let me connect you with one of our specialists who can help with that.',
    'Great, connecting you now.',
    ANTIBIOTICS_CALL.optOutBody,
    welcomeGreeting('John'),
    welcomeGreeting(null),
    spokenTime(new Date('2026-11-12T20:00:00Z'), 'America/New_York', new Date('2026-11-11T19:00:00Z')),
    SPECIALIST_LINE,
  ])('%j', (line) => {
    for (const sentence of sentences(line)) expect(checkSentence(sentence).reason).toBeNull();
  });
});
