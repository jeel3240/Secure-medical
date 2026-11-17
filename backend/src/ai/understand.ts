/**
 * Understand: what the lead just said - Phase 7, A28, docs/AI-AGENT.md section
 * 12. Pure: the prompt, the answer's shape and reading it back; OpenAI is asked
 * in `openai.ts`, and the decision is the policy's (`policy.ts`).
 *
 * A small job, so a small fast model does it (A24: `gpt-5.4-mini`, 0.71 s):
 * each act a short label - "asks:shipping", "objection:busy", "stop" - because
 * every word OpenAI writes is time the lead waits. The first part of the
 * prompt - what each act means, the answer ids, the objection ids - is the same
 * on every call and every turn, so OpenAI keeps it read.
 *
 * A bare "yes" or "no" to a yes-or-no question of hers needs no OpenAI at all
 * (`fastPath`) - 39 of A21's 103 real lead lines (A24).
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Knowledge } from './knowledge';
import { REAL_PERSON, UNCOVERED, type Act, type NoReason, type OpenQuestion, type SaidTime } from './policy';

/** The acts that take no topic. */
const PLAIN_ACTS = [
  'confirm_identity',
  'interested',
  'not_interested',
  'not_now',
  'wants_person',
  'wants_callback',
  'wants_link',
  'agrees',
  'declines',
  'emergency',
  'wrong_person',
  'stop',
  'unclear',
  'checking_line',
  'backchannel',
  'machine',
  'other',
] as const;

/** Objections that are already a plain act - offered once, as the act, so there is one way to write each. */
const OBJECTIONS_AS_ACTS = new Set(['not_interested', 'wrong_person']);

/** Every label the answer may hold: the plain acts, "asks:<topic>", "objection:<id>". */
export function actLabels(knowledge: Knowledge): string[] {
  return [
    ...PLAIN_ACTS,
    ...[...knowledge.answers.map((a) => a.id), UNCOVERED, REAL_PERSON].map((t) => `asks:${t}`),
    ...objectionIds(knowledge).map((id) => `objection:${id}`),
  ];
}

function objectionIds(knowledge: Knowledge): string[] {
  return knowledge.playbook.objections.map((o) => o.id).filter((id) => !OBJECTIONS_AS_ACTS.has(id));
}

/** How the policy's acts are written as labels - for the test set and the record (A31). */
export function actLabel(act: Act): string {
  if (act.act === 'asks') return `asks:${act.topic}`;
  if (act.act === 'objection') return `objection:${act.id}`;
  if (act.act === 'not_interested' && act.reason) return `not_interested:${act.reason}`;
  return act.act;
}

// ---------------------------------------------------------------------------
// The prompt

/** The first part: the same on every call, so OpenAI keeps it read. */
export function understandSystem(knowledge: Knowledge): string {
  return [
    'You read what a caller just said on a sales phone call from Seri, the virtual assistant of eDrugstore, and label it. You never reply to the caller: you only label.',
    '',
    'Label only what the caller just said - the earlier lines are there to show what they are answering, not to be labelled again. Return every act in it, in the order said, each with exactly one label from the list, each label once. Most lines are one act.',
    "Their words reach you as speech turned into text, and are sometimes misheard. Read them as they were most likely meant, using what Seri had just said; a line that still makes no sense where it comes is \"unclear\" - never guess what it meant.",
    '',
    '## The labels',
    '- confirm_identity: they say they are the person Seri asked for ("Yes", "Speaking", "This is John").',
    "- interested: they want the offer (\"Yes, I'm interested\", \"I'd like to order\").",
    "- not_interested: they turn the offer down - with `reason`: closed (a plain no, \"I'm not interested\", \"I don't need it\"), timing (now is a bad time, but maybe later - \"Just the timing\" when Seri asked whether it was the timing), product (not antibiotics in particular - \"I don't need antibiotics right now\").",
    '- not_now: "Not right now", "Maybe later" - not now, without turning it down for good.',
    '- wants_person: they ask to talk to a person on our team, or to be put through now ("Now is good", "Put me through"). "I want to talk with you" said to Seri herself is not wants_person - they want to keep talking to her, not to be put through: declines.',
    '- wants_callback: they ask to be called later, or give a time for it - even a time alone ("Twelve PM.", "So twelve PM?", "Tomorrow at two"). Fill `time` with the parts they said: day as said ("today" - "tonight" is today - "tomorrow", a weekday like "monday", or a date as YYYY-MM-DD), hour 1-12 or 0-23, minute, am or pm; null for any part they did not say. Never work out a part they did not say.',
    "- wants_link: they ask for the link or a text (\"Just text me the link\", \"Can you text me the details?\").",
    "- agrees / declines: yes or no to the question Seri just asked. To \"Is that something you'd be interested in?\", \"Yes\" is agrees. \"That's all\", \"I'm good\" to an offer is declines.",
    '- asks:<topic>: a question - always asks, never other. The topic is the answer below that answers it; "asks:uncovered" when none of them answers it - who runs the company ("Who is your CEO?"), who the person calling them back will be and their name (never customer_service), and anything we may not sell or do (medicine for a pet, another payment method) are uncovered; "asks:real_person" for "Are you a real person?" or "Are you a robot?". A question about their own health, symptoms, a dose, side effects or which medicine to take is asks:medical_question or asks:which_medication. Asking for a bigger discount is asks:offer.',
    '- asks:upset: the caller is upset, annoyed or complaining - about the calls, an order, anything - even with no question.',
    '- asks:personal_info: the caller starts giving personal details - a date of birth, an address, a card number.',
    "- objection:<id>: one of the objections below - a reason not to go on, said as a statement (\"I'm busy\", \"I already have a doctor\").",
    '- emergency: a medical emergency happening now.',
    "- wrong_person: only when they say plainly that Seri has the wrong person or the wrong number (\"There's no John here\", \"This is his wife\").",
    '- stop: they ask not to be called again, in any words ("Stop calling me", "Remove me from your list", "Unsubscribe", "Yes, remove it"). A question with the word stop in it - "Do I need to stop my medicine?" - is a question, not a stop.',
    "- unclear: you cannot make out what they meant - a name or words that do not fit what was just said, after they already said who they are, were most likely misheard.",
    '- checking_line: "Hello?", "Are you there?" - checking that someone is on the line.',
    '- backchannel: "Okay", "Uh huh", "Hmm", "Mm-hmm" on their own - listening, not a yes to anything.',
    '- machine: a voicemail greeting or menu ("Please leave a message after the tone", "To review your message, press 1").',
    '- other: anything else.',
    '',
    '## Answer topics',
    ...knowledge.answers.map((a) => `- ${a.id}: ${a.questions.slice(0, 3).join(' / ')}`),
    '',
    '## Objections',
    ...knowledge.playbook.objections.filter((o) => !OBJECTIONS_AS_ACTS.has(o.id)).map((o) => `- ${o.id}: ${o.leadSays.join(' / ')}`),
  ].join('\n');
}

export interface UnderstandInput {
  /** What the lead just said. */
  said: string;
  /** What Seri said last - the question they may be answering. */
  seri: string;
  /** A few turns before that, oldest first. */
  before: { who: 'lead' | 'seri'; text: string }[];
}

export function understandMessages(knowledge: Knowledge, input: UnderstandInput): ChatCompletionMessageParam[] {
  const line = (t: { who: 'lead' | 'seri'; text: string }) => `${t.who === 'seri' ? 'Seri' : 'Caller'}: ${t.text}`;
  const earlier = input.before.length ? `Earlier:\n${input.before.map(line).join('\n')}\n\n` : '';
  return [
    { role: 'system', content: understandSystem(knowledge) },
    { role: 'user', content: `${earlier}Seri just said: ${input.seri}\n\nThe caller just said: ${input.said}` },
  ];
}

/** The answer's shape - strict, so it always reads back. */
export function understandFormat(knowledge: Knowledge) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'acts',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['acts', 'reason', 'time'],
        properties: {
          acts: { type: 'array', items: { type: 'string', enum: actLabels(knowledge) } },
          reason: { type: ['string', 'null'], enum: ['closed', 'timing', 'product', null] },
          time: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['day', 'hour', 'minute', 'ampm'],
                properties: {
                  day: { type: ['string', 'null'] },
                  hour: { type: ['integer', 'null'] },
                  minute: { type: ['integer', 'null'] },
                  ampm: { type: ['string', 'null'], enum: ['am', 'pm', null] },
                },
              },
            ],
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Reading the answer back

export class UnderstandError extends Error {
  constructor(what: string) {
    super(`the understand answer could not be read: ${what}`);
    this.name = 'UnderstandError';
  }
}

/** The acts in OpenAI's answer. Throws `UnderstandError` on anything it does not know. */
export function parseActs(answer: string, knowledge: Knowledge): Act[] {
  let raw: unknown;
  try {
    raw = JSON.parse(answer);
  } catch {
    throw new UnderstandError('not JSON');
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { acts?: unknown }).acts)) throw new UnderstandError('no acts');
  const { acts, reason, time } = raw as { acts: unknown[]; reason?: unknown; time?: unknown };
  const labels = new Set(actLabels(knowledge));
  const noReason: NoReason | null = reason === 'closed' || reason === 'timing' || reason === 'product' ? reason : null;
  return [...new Set(acts)].map((label): Act => {
    if (typeof label !== 'string' || !labels.has(label)) throw new UnderstandError(`an unknown label ${JSON.stringify(label)}`);
    if (label.startsWith('asks:')) return { act: 'asks', topic: label.slice(5) };
    if (label.startsWith('objection:')) return { act: 'objection', id: label.slice(10) };
    if (label === 'not_interested') return { act: 'not_interested', reason: noReason };
    if (label === 'wants_callback') return { act: 'wants_callback', time: saidTime(time) };
    return { act: label } as Act;
  });
}

function saidTime(raw: unknown): SaidTime | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const time: SaidTime = {
    day: typeof t.day === 'string' && t.day.trim() ? t.day.trim().toLowerCase() : null,
    hour: int(t.hour),
    minute: int(t.minute),
    ampm: t.ampm === 'am' || t.ampm === 'pm' ? t.ampm : null,
  };
  return time.day === null && time.hour === null ? null : time;
}

// ---------------------------------------------------------------------------
// The fast path

/** Her questions a bare "yes" or "no" answers. */
const YES_NO_QUESTIONS: ReadonlySet<OpenQuestion> = new Set([
  'identity',
  'interest',
  'offer_connect',
  'offer_callback',
  'offer_link',
  'offer_products',
  'confirm',
  'anything_else',
]);

const LEAD_IN = String.raw`(?:(?:uh|um|oh|well|so|ah)[,.!]?\s+)*`;
const AFTER = String.raw`(?:[,.!]?\s+(?:please|ma'am|sir|thanks|thank you))?`;
const BARE_YES = new RegExp(String.raw`^${LEAD_IN}(?:yes|yeah|yep|yup|yes it is|yes i am|correct|sure|that's right)${AFTER}[.!]?$`, 'i');
const BARE_NO = new RegExp(String.raw`^${LEAD_IN}(?:no|nope|nah|no thanks|no thank you)${AFTER}[.!]?$`, 'i');

/**
 * A bare "yes" or "no" to a yes-or-no question of hers, read without OpenAI.
 * Null for anything else - "Okay" above all, which is never a yes (call 99).
 */
export function fastPath(said: string, open: OpenQuestion | null): Act[] | null {
  if (!open || !YES_NO_QUESTIONS.has(open)) return null;
  const words = said.trim().replace(/[’]/g, "'");
  if (BARE_YES.test(words)) return [open === 'identity' ? { act: 'confirm_identity' } : { act: 'agrees' }];
  if (BARE_NO.test(words)) return [{ act: 'declines' }];
  return null;
}
