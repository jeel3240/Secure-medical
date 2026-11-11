/**
 * Every sentence Seri is about to say, checked - Phase 7, A05,
 * docs/AI-AGENT.md section 6. Her instructions forbid prices, medical advice
 * and made-up offers; this is what stops one if she says it anyway. Pure: the
 * relay (A11) splits her streamed reply into sentences and asks this about
 * each before Twilio speaks it.
 *
 * A sentence that holds one is not said: the specialist line is, in its
 * place. The rules look at the words around a risky word, not the word
 * alone - "I can take you off our list" and "an overdose" are not advice -
 * and every line in the knowledge files passes unchanged (safety.test.ts).
 */

/** What Seri says in place of a sentence that cannot be said. */
export const SPECIALIST_LINE = "That's a great question for one of our specialists. Would you like me to connect you?";

export type SafetyReason =
  | 'price' // an amount of money
  | 'advice' // how to take a medicine, or whether it is safe for them
  | 'diagnosis' // what the lead has
  | 'discount'; // an offer other than "up to 25%", or made-up urgency

export interface SentenceCheck {
  /** What Seri says: the sentence, or `SPECIALIST_LINE`. */
  say: string;
  /** Why it was replaced; null when it is said as written. */
  reason: SafetyReason | null;
  /** The words that were found - for the call's own record (`call_ai_turns`), never the logs. */
  found: string | null;
}

interface Rule {
  reason: SafetyReason;
  pattern: RegExp;
  /** Only when the sentence is also about this - "you might have" only of an illness. */
  when?: RegExp;
}

const MEDICINE = /\b(take|taking|tablets?|pills?|capsules?|mg|milligrams?|doses?|apply|applying|cream|drops?)\b/;
const ILLNESS =
  /\b(infections?|uti|std|stds|sti|stis|herpes|chlamydia|gonorrhea|syphilis|trichomoniasis|hiv|virus|bacteria|bacterial|disease|condition|symptoms?|allerg\w*|diabet\w*|cancer|covid|flu)\b/;

const RULES: readonly Rule[] = [
  // An amount of money, in any form.
  { reason: 'price', pattern: /\$/ },
  { reason: 'price', pattern: /\b(dollars?|bucks|cents)\b/ },
  { reason: 'price', pattern: /\b\d+\.\d\d\b/ },
  { reason: 'price', pattern: /\bcosts?\b[^.?!]*\d/ },
  { reason: 'price', pattern: /\b(priced|price is|prices? (start|begin)s?)\b[^.?!]*\d/ },
  { reason: 'price', pattern: /\b\d+ (a|per|each) (month|pill|tablet|order|kit|box|bottle|pack)\b/ },

  // How to take a medicine, or whether it is safe for them.
  { reason: 'advice', pattern: /\b(dosage|dosing|dose|doses)\b/ },
  { reason: 'advice', pattern: /\byou(?:'d| would)? (should|must|ought to|need to|have to) (take|stop|avoid|apply|start taking|start using)\b/ },
  { reason: 'advice', pattern: /\b(recommend|suggest|advise)\w* (taking|using|starting|stopping|(that )?you (take|use|start|stop))\b/ },
  {
    reason: 'advice',
    pattern:
      /\b(once|twice|three times|four times|\d+ times|times a day|a day|daily|per day|every \d+ hours|every (four|six|eight|twelve) hours|every (morning|night|day)|before bed|with food|with water|on an empty stomach)\b/,
    when: MEDICINE,
  },
  { reason: 'advice', pattern: /\bside effects?\b/ },
  { reason: 'advice', pattern: /\b(safe (for you|to take|to use|with)|won't interact|interacts? with|interactions?)\b/ },

  // What the lead has.
  { reason: 'diagnosis', pattern: /\b(sounds|seems|looks) like you(?:'ve| have| might| may| could)\b/ },
  { reason: 'diagnosis', pattern: /\byou (probably|likely|definitely|clearly) have\b/ },
  { reason: 'diagnosis', pattern: /\byou (might|may|could|must) be (suffering|infected)\b/ },
  { reason: 'diagnosis', pattern: new RegExp(`\\byou (might|may|could|must) have (got )?(a |an |some )?(\\w+ ){0,2}${ILLNESS.source}`) },
  { reason: 'diagnosis', pattern: /\byou(?:'ve| have) (got )?(a|an) (\w+ )?(infection|uti|std|sti|virus)\b/ },

  // An offer we do not make.
  { reason: 'discount', pattern: /\b(today only|only today|just today|limited time|act now|hurry|last chance|this week only|while supplies last|ends (today|tonight|soon|this week)|expires? (today|tonight|soon))\b/ },
  { reason: 'discount', pattern: /\b(half off|half price|buy one,? get one|bogo)\b/ },
];

const NUMBER_WORDS: Record<string, number> = {
  five: 5,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

/**
 * Every percentage in the sentence - "25%", "25 percent", "twenty-five
 * percent" - is the offer said right: 25, with "up to" just before it.
 * Returns the first that is not.
 */
function wrongPercentage(text: string): string | null {
  const percentages = /(\d+(?:\.\d+)?|(?:[a-z]+[- ])?[a-z]+)\s*(%|percent\b|per cent\b)/g;
  for (const match of text.matchAll(percentages)) {
    const amount = match[1];
    const value = /^\d/.test(amount)
      ? Number(amount)
      : amount.split(/[- ]/).reduce((sum, word) => sum + (NUMBER_WORDS[word] ?? NaN), 0);
    const before = text.slice(0, match.index);
    if (value !== 25 || !/\bup to\s+$/.test(before)) return match[0].trim();
  }
  return null;
}

/** The sentence, as Seri may say it: unchanged, or the specialist line and why. */
export function checkSentence(sentence: string): SentenceCheck {
  const text = sentence.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
  for (const rule of RULES) {
    const found = rule.pattern.exec(text);
    if (found && (!rule.when || rule.when.test(text))) {
      return { say: SPECIALIST_LINE, reason: rule.reason, found: found[0] };
    }
  }
  const percentage = wrongPercentage(text);
  if (percentage) return { say: SPECIALIST_LINE, reason: 'discount', found: percentage };
  return { say: sentence, reason: null, found: null };
}
