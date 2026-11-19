/**
 * Speak: her words for the moves the policy chose - Phase 7, A29,
 * docs/AI-AGENT.md section 12. Pure: the prompt for each reply; OpenAI streams
 * it (`openai.ts`), the brain (`brain.ts`) sends it.
 *
 * What she does is already decided (`policy.ts`); she is told it, with only
 * the facts it needs, and words it herself - never a fixed line, never a
 * decision of her own. The long prompt of before - every rule, objection and
 * example, which she copied word for word (call 112's opening, said again) -
 * is gone: her persona is the same on every call, so OpenAI keeps it read,
 * and each reply adds a short brief.
 *
 * Two things are not hers to word: an approved answer, said by code exactly
 * as the client wrote it (`answerLine`), and the stop line.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { CallHours } from '../core/auto-dial';
import type { Handoff } from './actions';
import { callPart, cleanFirstName, type WhoIsThere } from './instructions';
import type { Knowledge } from './knowledge';
import type { CallState, Move, OfferKind, OpenQuestion } from './policy';
import { TONES, spokenWords } from './tone';

export interface SpeakSetup {
  knowledge: Knowledge;
  lead: { firstName: string | null; phone: string };
  now: Date;
  hours: CallHours;
}

/** Her persona: the same on every call on this server up to the call's own details, so OpenAI keeps it read. */
export function speakSystem({ knowledge, lead, now, hours }: SpeakSetup): string {
  const { playbook } = knowledge;
  return [
    "You are Seri, eDrugstore's virtual assistant, on a live phone call with someone who signed up on one of eDrugstore's partner sites and asked to be contacted. Every word you write is spoken aloud by a voice as you write it.",
    '',
    'What you do next has already been decided. Before each reply you are told what to do in it, in order, and the facts to use. Do exactly that, in your own words - nothing more and nothing else. You never decide to transfer, book a call back, text a link or end the call yourself: when the call ends, you are told so, and you say only your last line.',
    '',
    '## How you speak',
    '- This is a phone call. Write only words to be said: no lists, no symbols, no emojis, no web addresses.',
    ...playbook.style.map((line) => `- ${line}`),
    '- Whenever you mention the offer, say "up to 25% off your first order", exactly so.',
    "- Never say you don't know, can't answer, can't provide or share something, or don't have that information.",
    '- Never the same sentence twice in a call: anything you say again, say in new words.',
    '',
    '## How you sound',
    'Begin every reply with the one of these tones that fits, in square brackets, and add another only where the feeling changes. It is not said aloud: the voice says what follows that way.',
    ...TONES.map((t) => `- ${t.tag}: ${t.when}`),
    'Use only these, written exactly so, at most two in a reply. Sound like a professional on a work call: friendly and polite, never flirty, breathy or intimate.',
    '',
    '## Never',
    ...knowledge.rules.map((rule) => `- ${rule}`),
    ...playbook.never.map((line) => `- ${line}`),
    '',
    '## Products you may name, when you are told to talk about them',
    ...knowledge.products.map((p) => `- ${p.name}: "${p.spokenLine}"`),
    '',
    callPart({ lead, now, hours }),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// What each move asks of her

const OFFERS: Record<OfferKind, string> = {
  connect: 'Offer to connect them with someone on our team now.',
  callback: 'Offer a call back at a time that suits them.',
  link: 'Offer to text them a link so they can look things over.',
  products: 'Say we also have at-home STI test kits and other treatments, and ask if any of those would help.',
};

const OPEN: Record<OpenQuestion, string> = {
  identity: 'whether you are speaking to the right person',
  interest: 'whether the offer is something they would be interested in',
  why: 'whether it is the timing, or just not something they need',
  offer_connect: 'whether they would like you to connect them with someone now',
  offer_callback: 'whether a call back at another time would suit them',
  offer_link: 'whether they would like the link by text',
  offer_products: 'whether the other products would help',
  time: 'what time would suit them for a call back',
  confirm: 'whether the time you said back works',
  anything_else: 'whether there is anything else they would like to know',
};

/** Why a day said alone has no call back (call 122). */
const DAY_REFUSED: Record<string, string> = {
  closed_day: 'our team does not work that day - the agent hours are below',
  none_left: "our team's hours that day are over",
  too_far: 'that is too far ahead - a call back can be booked up to two weeks out',
};

/** A day as the brief says it: "tomorrow", "on Monday", "on Monday, November 30". */
function dayWords(day: string): string {
  if (day === 'today' || day === 'tomorrow') return day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const d = new Date(`${day}T12:00:00Z`);
    return `on ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
  }
  return `on ${day.charAt(0).toUpperCase()}${day.slice(1)}`;
}

const REFUSED: Record<string, string> = {
  outside_hours: 'our team works only during the agent hours below',
  past: 'that time has already gone',
  too_soon: 'that is too soon to set up',
  too_far: 'that is too far ahead',
};

const LAST_LINE: Record<string, string> = {
  not_interested: 'Thank them for their time and say goodbye - nothing offered, no question.',
  wrong_person: 'Apologize for the mix-up and say goodbye.',
  emergency: 'Say goodbye, and that they should call 911 now.',
  other: 'Thank them and say goodbye - no question.',
};

function endLine(handoff: Handoff, firstName: string | null): string {
  switch (handoff.action) {
    case 'transfer_to_agent':
      return 'Say you are connecting them with someone now - one short sentence, no question.';
    case 'book_callback':
      return 'Say the call back is booked for the time they agreed, and say goodbye - no question.';
    case 'send_link':
      return 'Say the link is on its way by text, and say goodbye - no question.';
    case 'end_call':
      return LAST_LINE[handoff.reason] ?? LAST_LINE.other;
    default:
      return `Say goodbye${firstName ? `, ${firstName}` : ''} - no question.`;
  }
}

/** The brief for one move, in words she acts on. */
export function moveBrief(move: Move, who: WhoIsThere, firstName: string | null): string {
  switch (move.move) {
    case 'opening':
      return "Say who you are - Seri from eDrugstore - and that you're calling about our offer of up to 25% off their first order, then ask if it's something they'd be interested in. The greeting is already said: don't say hello or their name again. Don't say how we got their details.";
    case 'answer':
      return move.again
        ? `They asked again about something you already answered. Say it again briefly, in new words: "${move.text}"`
        : `You have just said: "${move.text}" - don't say it again, or any part of it, or add to it: go straight on to what follows.`;
    case 'specialist':
      return `${
        move.again
          ? "They asked again. It still has an answer: it's exactly the kind of thing our specialists can tell them - say that, in new words. It is not a question you lack an answer to: never say you don't have it, don't know it, or can't share or provide it - not even before saying the specialists can."
          : "It's a question our specialists can answer - say so in your own words. Never that you don't know, can't answer or don't have it."
      }${who === 'nobody' ? " Don't offer to connect them now: nobody is free." : ''}`;
    case 'virtual':
      return "Say honestly that you're eDrugstore's virtual assistant.";
    case 'objection':
      return OBJECTION_BRIEFS[move.id] ?? 'Answer what they said, briefly and kindly.';
    case 'ask_why':
      return "Ask, alone and kindly, whether it's more the timing or just not something they need right now. Offer nothing with it.";
    case 'offer':
      return OFFERS[move.kind];
    case 'busy':
      return 'Say plainly that everyone on our team is busy right now.';
    case 'ask_time':
      return move.instead
        ? `They asked for ${move.instead.asked}, but ${DAY_REFUSED[move.instead.why]}. Say why first, plainly, then ask what time${move.day ? ` ${dayWords(move.day)}` : ' in the next two weeks'} would suit them for a call back.`
        : `Ask what time${move.day ? ` ${dayWords(move.day)}` : ''} would suit them for a call back.`;
    case 'confirm_time':
      return move.instead
        ? `They asked for ${move.asked}, but ${REFUSED[move.instead] ?? 'that time is not possible'}. Say why first, plainly, then offer this time instead, as a question, in exactly these words for the time: "${move.spoken}".`
        : `Say the time back as a question, in exactly these words for the time: "${move.spoken}" - for example "So that's ${move.spoken}?". Nothing after it.`;
    case 'ask_repeat':
      return "Say you didn't catch that, and ask them to say it again.";
    case 'still_here':
      return "Say you're here - briefly.";
    case 'return_to':
      return `Come back, briefly and in new words, to your question: ${OPEN[move.open]}.`;
    case 'anything_else':
      return "Ask if there's anything else they'd like to know.";
    case 'end':
      return endLine(move.handoff, firstName);
    default: {
      const never: never = move;
      throw new Error(`a move speak does not know: ${JSON.stringify(never)}`);
    }
  }
}

/** The objections she words herself - from the playbook's approach (A26). */
const OBJECTION_BRIEFS: Record<string, string> = {
  have_doctor:
    "They already have a doctor: say that's great, and that a lot of our customers use us alongside their doctor, because it's quick and ships to their home.",
  too_expensive:
    "They think it's too expensive: encourage them, kindly, to compare - there's a good chance ours is lower, and we ship it to their home.",
  scam: "They worry it's a scam: say you understand, that eDrugstore has been around for over 25 years, and they can check our customer reviews on Trustpilot.",
  never_signed_up:
    "They say they never signed up: say they signed up on one of our partner sites, and if they'd rather not hear from us, you can remove their number.",
};

/** What she already said that matters for this reply: the openings to avoid, the answers already given. */
function ledger(state: CallState): string[] {
  const notes: string[] = [];
  if (state.openings.length) notes.push(`Your last replies began "${state.openings.join('" and "')}" - begin this one differently.`);
  return notes;
}

/** One reply's brief: what to do, in order - the reply that follows an approved answer already said, if any. */
export function replyBrief(moves: readonly Move[], state: CallState, who: WhoIsThere, firstName: string | null): string {
  const name = cleanFirstName(firstName);
  const steps = moves.map((m, i) => `${i + 1}. ${moveBrief(m, who, name)}`);
  const ending = moves.some((m) => m.move === 'end');
  return [
    'Your reply now - do these, in order, and nothing else:',
    ...steps,
    ...(who === 'nobody'
      ? ["Nobody on our team is free right now: never offer to connect them, put them through or have them talk to someone now - and don't mention who is free unless a step above says to (call 103)."]
      : []),
    ...(ending ? ['This is your last line: no question in it.'] : ['At most one question, and only as the last thing you say.']),
    ...ledger(state),
  ].join('\n');
}

/**
 * The messages for one reply: her persona, the recent turns, what code has
 * already said of this reply - an approved answer, her introduction - as her
 * own words, then the brief. Without that last turn the lead's question stood
 * unanswered in what speak read, and it answered it again in its own words:
 * "I can't share exact prices", "we ship nationwide, including Texas" (calls
 * 118-120; 5 and 9 runs in 10 on the eval).
 */
export function speakMessages(
  system: string,
  recent: { who: 'lead' | 'seri'; text: string }[],
  brief: string,
  saidByCode: readonly string[] = []
): ChatCompletionMessageParam[] {
  const said = saidByCode.map((line) => spokenWords(line).trim()).filter(Boolean).join(' ');
  return [
    { role: 'system', content: system },
    ...recent.slice(-6).map((t): ChatCompletionMessageParam => (t.who === 'seri' ? { role: 'assistant', content: t.text } : { role: 'user', content: t.text })),
    ...(said ? [{ role: 'assistant' as const, content: said }] : []),
    { role: 'system', content: brief },
  ];
}

// ---------------------------------------------------------------------------
// The approved answers, said by code

/** The tone an approved answer is said in. */
const ANSWER_TONES: Readonly<Record<string, string>> = {
  medical_question: '[reassuring, calm]',
  which_medication: '[reassuring, calm]',
  emergency: '[reassuring, calm]',
  scam: '[reassuring, calm]',
  safe: '[reassuring, calm]',
  legal: '[reassuring, calm]',
  privacy: '[reassuring, calm]',
  personal_info: '[reassuring, calm]',
  upset: '[apologetic]',
};

/** An approved answer as it is said: its tone, then the client's words exactly - `{callback_number}` read digit by digit. */
export function answerLine(id: string, text: string, callbackNumber: string): string {
  return `${ANSWER_TONES[id] ?? '[friendly]'} ${text.split('{callback_number}').join(callbackNumber)}`;
}

/**
 * Her introduction, the same on every call, saved (2026-11-18): said by code the
 * moment the greeting is answered - after "Yes." she waited 1-2 s for speak to
 * write much the same line each call (calls 118, 119). No name in it, nothing of
 * the call's own.
 */
export const OPENING_LINE =
  '[friendly, upbeat] This is Seri from eDrugstore, calling about our offer of up to 25% off your first order. [curious] Would you like to hear more about it?';

/**
 * Whether the introduction is said by code: when nothing else in the reply needs
 * her words - a bare "Yes.", or an approved answer and then the introduction. With
 * anything speak must word, speak words the introduction too, so her one question
 * stays the last thing she says.
 */
export function openingByCode(moves: readonly Move[]): boolean {
  return moves.some((m) => m.move === 'opening') && moves.every((m) => m.move === 'opening' || (m.move === 'answer' && !m.again));
}

/** What code says of a reply before speak, in order: the approved answers, then her introduction when it is by code. */
export function codeLines(moves: readonly Move[], callbackNumber: string): string[] {
  const lines = moves.flatMap((m) => (m.move === 'answer' && !m.again ? [answerLine(m.id, m.text, callbackNumber)] : []));
  if (openingByCode(moves)) lines.push(OPENING_LINE);
  return lines;
}

/** The moves speak words: all but the approved answers - and the introduction - said by code. */
export function spokenMoves(moves: readonly Move[]): Move[] {
  const opening = openingByCode(moves);
  return moves.filter((m) => !(m.move === 'answer' && !m.again) && !(opening && m.move === 'opening'));
}

/** Whether a reply needs speak at all: an approved answer alone does not. */
export function needsSpeak(moves: readonly Move[]): boolean {
  return spokenMoves(moves).length > 0;
}
