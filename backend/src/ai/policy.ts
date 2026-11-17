/**
 * What Seri does next - Phase 7, A27, docs/AI-AGENT.md section 12, "Decide".
 * Pure: no OpenAI, no database, no clock of its own.
 *
 * Until A24 one OpenAI request worked out, from the transcript alone, where
 * the call was and what to do - and on A21's real calls it said the opening
 * again two and a half minutes in, offered to connect in 7 of 9 replies,
 * booked a time it chose, kept offering after two clear no's. Here the call
 * has a record (`CallState`), and the next move is decided from it by rules
 * that hold every time; OpenAI only says what the lead did (understand, A28)
 * and words the moves (speak, A29).
 *
 *   decide(state, acts, context) -> the moves for her reply, and the record
 *                                   with what the lead did
 *   markSaid(state, moves)       -> the record with what she said - only the
 *                                   moves the lead heard, when talked over (A30)
 */

import type { CallHours, Weekday } from '../core/auto-dial';
import type { EndReason, Handoff } from './actions';
import { atLocalTime, checkCallbackTime, spokenTime, toLocalTime, type CallbackRefusal } from './callback-time';
import type { WhoIsThere } from './instructions';
import type { AnswerOffer, Knowledge } from './knowledge';

/** Kept with every record (A31): a record from another version is read with care, not trusted. */
export const POLICY_VERSION = 1;

// ---------------------------------------------------------------------------
// What the lead did - from the understand step (A28), or the fast path

export type NoReason = 'closed' | 'timing' | 'product';

/** A call-back time as the lead said it - the parts, never a date the model worked out (A24: call 93's Saturday). */
export interface SaidTime {
  /** "today", "tomorrow", a weekday ("monday"), a date ("2026-11-19"), or null. */
  day: string | null;
  hour: number | null;
  minute: number | null;
  ampm: 'am' | 'pm' | null;
}

export type Act =
  | { act: 'confirm_identity' }
  | { act: 'interested' }
  | { act: 'not_interested'; reason: NoReason | null }
  | { act: 'not_now' }
  | { act: 'wants_person' }
  | { act: 'wants_callback'; time: SaidTime | null }
  | { act: 'wants_link' }
  | { act: 'agrees' }
  | { act: 'declines' }
  /** A question: an approved answer's id, or `UNCOVERED`, or `REAL_PERSON`. */
  | { act: 'asks'; topic: string }
  /** One of the playbook's objections, by id (A26). */
  | { act: 'objection'; id: string }
  | { act: 'emergency' }
  | { act: 'wrong_person' }
  | { act: 'stop' }
  | { act: 'unclear' }
  | { act: 'checking_line' }
  | { act: 'backchannel' }
  | { act: 'machine' }
  | { act: 'other' };

/** A question no approved answer covers - our specialists can tell them. */
export const UNCOVERED = 'uncovered';
/** "Are you a real person?" */
export const REAL_PERSON = 'real_person';

/** Objections the client answered in an approved answer: said as that answer, word for word. */
const OBJECTION_ANSWERS: Readonly<Record<string, string>> = {
  scam: 'scam',
  too_expensive: 'cheaper_pharmacy',
  never_signed_up: 'how_got_number',
};

/** Objections worded from their approach - the others are routed (a no, busy, the link) or are an approved answer. */
const WORDED_OBJECTIONS = new Set(['have_doctor', 'too_expensive', 'scam', 'never_signed_up']);

/** Questions the opening itself answers. */
const OPENING_TOPICS = new Set(['why_calling', 'who_we_are', 'offer', 'medical_web']);

// ---------------------------------------------------------------------------
// The record of the call

export type OfferKind = 'connect' | 'callback' | 'link' | 'products';
export type OfferAnswer = 'none' | 'yes' | 'no';

/** Her question the lead has not answered yet. */
export type OpenQuestion =
  | 'identity' // the greeting: "Hi, is this John?"
  | 'interest' // the offer: "Is that something you'd be interested in?"
  | 'why' // after a no: "Is it more the timing, or…?"
  | 'offer_connect'
  | 'offer_callback'
  | 'offer_link'
  | 'offer_products'
  | 'time' // "What time works for you?"
  | 'confirm' // "So that's Monday at 2 PM your time?"
  | 'anything_else';

export interface CallState {
  version: number;
  stage: 'greeting' | 'talking' | 'closing';
  /** They said it is them. */
  identity: boolean;
  interest: 'unknown' | 'yes' | 'no';
  /** Clear no's: two end the call. */
  nos: number;
  whyAsked: boolean;
  offers: Record<OfferKind, { made: number; answer: OfferAnswer }>;
  open: OpenQuestion | null;
  /** A call back: the day they named with no hour yet, and the time she said back. */
  callback: { day: string | null; proposed: string | null };
  /** Lines in a row she could not make out. */
  misheard: number;
  /** How often each approved answer was given. */
  answered: Record<string, number>;
  /** How often she said a question is our specialists' to answer. */
  specialist: number;
  /** "Everyone on our team is busy right now" - said once is enough. */
  busySaid: boolean;
  /** A medical or uncovered question was asked - the call back's reason. */
  wantsSpecialist: boolean;
  /** Her last reply came back to her open question, or asked if there was anything else: not twice in a row. */
  returned: boolean;
  askedAnythingElse: boolean;
  /** The three minutes: the closing offer is due, then made. */
  wrapUp: 'not_yet' | 'due' | 'offered';
  /** How her last two replies began - so the next does not begin the same way (A29). */
  openings: string[];
}

export function startState(): CallState {
  const offer = () => ({ made: 0, answer: 'none' as OfferAnswer });
  return {
    version: POLICY_VERSION,
    stage: 'greeting',
    identity: false,
    interest: 'unknown',
    nos: 0,
    whyAsked: false,
    offers: { connect: offer(), callback: offer(), link: offer(), products: offer() },
    open: 'identity',
    callback: { day: null, proposed: null },
    misheard: 0,
    answered: {},
    specialist: 0,
    busySaid: false,
    wantsSpecialist: false,
    returned: false,
    askedAnythingElse: false,
    wrapUp: 'not_yet',
    openings: [],
  };
}

// ---------------------------------------------------------------------------
// What she does: the moves of one reply

export type Move =
  /** Who she is, the offer, and whether they are interested - only once, at the start. */
  | { move: 'opening' }
  /** An approved answer: said by code word for word (`text`) - or, asked again, briefly in her words (`again`). */
  | { move: 'answer'; id: string; text: string; again: boolean }
  /** A question no approved answer covers: our specialists can tell them - never "I don't know". */
  | { move: 'specialist'; again: boolean }
  /** She is eDrugstore's virtual assistant. */
  | { move: 'virtual' }
  /** A playbook objection, worded from its approach. */
  | { move: 'objection'; id: string }
  | { move: 'ask_why' }
  | { move: 'offer'; kind: OfferKind }
  /** Nobody can take a call now, said plainly. */
  | { move: 'busy' }
  /** When would suit for a call back - on `day` if they named one. */
  | { move: 'ask_time'; day: string | null }
  /**
   * The time said back, as a question. `instead`: the time they asked for
   * could not be booked, and why - this is the nearest that can (`asked`, theirs).
   */
  | { move: 'confirm_time'; at: string; zone: string; spoken: string; instead: CallbackRefusal | null; asked: string | null }
  | { move: 'ask_repeat' }
  /** "Yes, I'm here." */
  | { move: 'still_here' }
  /** Her open question again, briefly and in new words. */
  | { move: 'return_to'; open: OpenQuestion }
  | { move: 'anything_else' }
  /** The call ends: her last line, then the action. */
  | { move: 'end'; handoff: Handoff };

/** The moves that ask the lead something: at most one in a reply, and it comes last. */
export function asks(move: Move): boolean {
  return ['opening', 'ask_why', 'offer', 'ask_time', 'confirm_time', 'ask_repeat', 'return_to', 'anything_else'].includes(move.move);
}

export interface PolicyContext {
  who: WhoIsThere;
  now: Date;
  hours: CallHours;
  /** The lead's zone - from the area code (`leadTimeZone`). */
  leadZone: string;
  knowledge: Knowledge;
}

export interface Decision {
  /** The record with what the lead did; `markSaid` adds what she said. */
  state: CallState;
  /** Her reply, in order. Empty: she says nothing and listens on (a voicemail greeting). */
  moves: Move[];
}

// ---------------------------------------------------------------------------
// Deciding

const copy = (s: CallState): CallState => ({
  ...s,
  offers: {
    connect: { ...s.offers.connect },
    callback: { ...s.offers.callback },
    link: { ...s.offers.link },
    products: { ...s.offers.products },
  },
  callback: { ...s.callback },
  answered: { ...s.answered },
  openings: [...s.openings],
});

const UNDERSTOOD_NOTHING = new Set<Act['act']>(['unclear', 'other', 'backchannel', 'checking_line']);
const ROUTING = new Set<Act['act']>([
  'interested',
  'not_interested',
  'not_now',
  'wants_person',
  'wants_callback',
  'wants_link',
  'agrees',
  'declines',
]);

export function decide(previous: CallState, acts: readonly Act[], context: PolicyContext): Decision {
  const s = copy(previous);
  const has = <K extends Act['act']>(name: K) => acts.find((a): a is Extract<Act, { act: K }> => a.act === name);
  const open = s.open;
  const done = (moves: Move[]) => ({ state: s, moves: shape(moves) });
  const objectionIds = acts.filter((a): a is Extract<Act, { act: 'objection' }> => a.act === 'objection').map((a) => a.id);
  // An answer to her question closes it; a question of theirs instead leaves it open.
  if (acts.some((a) => ROUTING.has(a.act))) s.open = null;

  if (acts.some((a) => !UNDERSTOOD_NOTHING.has(a.act))) s.misheard = 0;

  // Whatever else was said, these come first.
  if (has('stop')) return done([{ move: 'end', handoff: { action: 'opt_out' } }]);
  if (has('emergency')) return done([answer(s, 'emergency', context), end('end_call', 'emergency')]);
  if (acts.length > 0 && acts.every((a) => a.act === 'machine')) return done([]);

  // The wrong person - only said plainly, and only before they said it is them: after it, a line like that was misheard (call 109).
  const saysWrongPerson =
    has('wrong_person') !== undefined || objectionIds.includes('wrong_person') || (open === 'identity' && has('declines') !== undefined && !has('confirm_identity'));
  if (saysWrongPerson && !s.identity) return done([end('end_call', 'wrong_person')]);
  if (has('confirm_identity') || (open === 'identity' && has('agrees'))) s.identity = true;
  if (saysWrongPerson) return done(misheard(s));

  // The greeting answered - however: the opening, once (call 112: said again two and a half minutes in).
  // Asking for a person, a call back or the link straight away is answered as asked.
  const asksForSomething = has('wants_person') || has('wants_callback') || has('wants_link');
  if (s.stage === 'greeting' && asksForSomething) s.stage = 'talking';
  if (s.stage === 'greeting') {
    const question = acts.find((a): a is Extract<Act, { act: 'asks' }> => a.act === 'asks' && !OPENING_TOPICS.has(a.topic));
    return done([...(question ? questionMoves(s, question.topic, context) : []), { move: 'opening' }]);
  }

  // A time for a call back, or a yes to the one she said back.
  const time = has('wants_callback')?.time ?? null;
  if (time && (time.hour !== null || time.day !== null)) return done([...answersFor(s, acts, context), ...timeMoves(s, time, context)]);
  // A yes to the time she said back - read as asking for the call back again counts the same (call 93: "Yes.").
  if (open === 'confirm' && (has('agrees') || has('wants_callback')) && s.callback.proposed) return done([book(s, context)]);
  if (open === 'confirm' && has('declines')) {
    s.callback.proposed = null;
    return done([{ move: 'ask_time', day: s.callback.day }]);
  }

  // What they want.
  const agrees = has('agrees') !== undefined;
  const declines = has('declines') !== undefined;
  const wantsLink = has('wants_link') || (open === 'offer_link' && agrees);
  const wantsPerson = has('wants_person') || (open === 'offer_connect' && agrees);
  const wantsCallback = has('wants_callback') || (open === 'offer_callback' && agrees) || objectionIds.includes('busy');
  const interested = has('interested') || ((open === 'interest' || open === 'offer_products') && agrees);
  const noAct = has('not_interested') ?? (objectionIds.includes('not_interested') ? { act: 'not_interested' as const, reason: null } : undefined);
  const notNow = has('not_now') !== undefined;
  const offerOpen = open?.startsWith('offer_') ? (open.slice(6) as OfferKind) : null;
  const says = (kind: OfferKind, answer: OfferAnswer) => {
    s.offers[kind].answer = answer;
  };

  if (offerOpen && (agrees || wantsLink || wantsPerson || wantsCallback || interested)) says(offerOpen, 'yes');
  if (wantsLink) return done([...answersFor(s, acts, context), { move: 'end', handoff: { action: 'send_link' } }]);
  if (wantsPerson) {
    s.interest = 'yes';
    if (context.who !== 'nobody') return done([{ move: 'end', handoff: { action: 'transfer_to_agent' } }]);
    return done([...answersFor(s, acts, context), ...busyAskTime(s)]);
  }
  if (wantsCallback) return done([...answersFor(s, acts, context), { move: 'ask_time', day: s.callback.day }]);
  if (interested) {
    s.interest = 'yes';
    if (context.who === 'nobody') return done([...answersFor(s, acts, context), ...busyAskTime(s)]);
    return done([...answersFor(s, acts, context), { move: 'offer', kind: s.offers.connect.answer === 'no' ? 'callback' : 'connect' }]);
  }

  // A no - to the offer, to an offer she made, or the reason after "why".
  const productNo = objectionIds.includes('dont_need_antibiotics');
  const isNo = noAct || notNow || productNo || (declines && (open === 'interest' || open === 'why' || offerOpen !== null));
  if (isNo) {
    const reason: NoReason | null = productNo ? 'product' : notNow ? 'timing' : (noAct?.reason ?? null);
    return done(noMoves(s, reason, offerOpen, open));
  }
  // "I need to think about it": the door left open with the link.
  if (objectionIds.includes('think_about_it')) return done(offerOrFollowUp(s, 'link', context, answersFor(s, acts, context)));

  // "Anything else?" - "No, that's all."
  if (open === 'anything_else' && declines) {
    if (s.interest === 'yes') return done(context.who === 'nobody' ? busyAskTime(s) : [{ move: 'offer', kind: 'connect' }]);
    if (s.interest === 'unknown' && s.offers.connect.made === 0) return done([{ move: 'return_to', open: 'interest' }]);
    return done([end('end_call', 'other')]);
  }

  // Questions and objections, then one question to go on with.
  const statements = answersFor(s, acts, context);
  if (statements.length > 0) return done([...statements, ...followUp(s, statements, context)]);

  // "Hello?" - she is here, and her question still stands.
  if (has('checking_line')) return done([{ move: 'still_here' }, ...(open ? [{ move: 'return_to' as const, open }] : [])]);
  // "Okay" is never a yes (call 99): her question again - or, with none open, nothing; she listens on.
  if (has('backchannel') && !acts.some((a) => ROUTING.has(a.act))) {
    return done(open && !s.returned ? [{ move: 'return_to', open }] : []);
  }
  if (has('unclear') && acts.every((a) => UNDERSTOOD_NOTHING.has(a.act))) return done(misheard(s));
  return done(followUp(s, [], context));
}

/** The moves for each question and objection said - at most two, each once. */
function answersFor(s: CallState, acts: readonly Act[], context: PolicyContext): Move[] {
  const moves: Move[] = [];
  for (const a of acts) {
    if (a.act === 'asks') moves.push(...questionMoves(s, a.topic, context));
    if (a.act === 'objection') {
      const id = OBJECTION_ANSWERS[a.id];
      if (id && context.knowledge.answers.some((x) => x.id === id)) moves.push(answer(s, id, context));
      else if (WORDED_OBJECTIONS.has(a.id)) moves.push({ move: 'objection', id: a.id });
    }
  }
  const seen = new Set<string>();
  return moves
    .filter((m) => {
      const key = m.move === 'answer' ? `answer:${m.id}` : m.move;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2);
}

function questionMoves(s: CallState, topic: string, context: PolicyContext): Move[] {
  if (topic === REAL_PERSON) return [{ move: 'virtual' }];
  const known = context.knowledge.answers.some((a) => a.id === topic);
  if (!known || topic === UNCOVERED) {
    s.wantsSpecialist = true;
    return [{ move: 'specialist', again: s.specialist > 0 }];
  }
  if (topic === 'medical_question' || topic === 'which_medication') s.wantsSpecialist = true;
  return [answer(s, topic, context)];
}

function answer(s: CallState, id: string, context: PolicyContext): Move {
  const found = context.knowledge.answers.find((a) => a.id === id);
  return { move: 'answer', id, text: found?.spoken ?? '', again: (s.answered[id] ?? 0) > 0 };
}

/** One question to go on with, after what she said: her open question, an answer's offer, or "anything else?". */
function followUp(s: CallState, said: readonly Move[], context: PolicyContext): Move[] {
  if (s.wrapUp === 'due') return [wrapUpOffer(s, context)];
  if (s.wrapUp === 'offered' && said.length === 0) return [end('end_call', 'other')];
  if (s.open && s.open !== 'anything_else' && s.open !== 'identity' && !s.returned) return [{ move: 'return_to', open: s.open }];
  const leadsTo = new Set<AnswerOffer>();
  for (const m of said) {
    if (m.move === 'answer') for (const o of context.knowledge.answers.find((a) => a.id === m.id)?.offers ?? []) leadsTo.add(o);
    if (m.move === 'specialist' || m.move === 'virtual') leadsTo.add('connect');
  }
  const offer = pickOffer(s, leadsTo, context);
  if (offer) return [{ move: 'offer', kind: offer }];
  if (s.interest === 'unknown' && !s.returned && s.offers.connect.made === 0) return [{ move: 'return_to', open: 'interest' }];
  return s.askedAnythingElse ? [] : [{ move: 'anything_else' }];
}

/**
 * Which offer an answer leads to, by who is there: a person only when someone
 * is free or coming; with nobody, a call back. Each once: one they turned
 * down or let pass is not made again (call 90: seven of nine replies offered
 * to connect) - interest shown is answered on its own path.
 */
function pickOffer(s: CallState, leadsTo: ReadonlySet<AnswerOffer>, context: PolicyContext): OfferKind | null {
  const fresh = (kind: OfferKind) => s.offers[kind].made === 0 && s.offers[kind].answer !== 'no';
  if (leadsTo.has('connect') && context.who !== 'nobody' && fresh('connect')) return 'connect';
  if ((leadsTo.has('connect') || leadsTo.has('callback')) && fresh('callback')) return 'callback';
  if (leadsTo.has('link') && fresh('link')) return 'link';
  return null;
}

function offerOrFollowUp(s: CallState, kind: OfferKind, context: PolicyContext, before: Move[]): Move[] {
  return s.offers[kind].answer === 'no' ? [...before, ...followUp(s, before, context)] : [...before, { move: 'offer', kind }];
}

function wrapUpOffer(s: CallState, context: PolicyContext): Move {
  if (context.who !== 'nobody' && s.offers.connect.answer !== 'no') return { move: 'offer', kind: 'connect' };
  if (s.offers.callback.answer !== 'no') return { move: 'offer', kind: 'callback' };
  return { move: 'offer', kind: 'link' };
}

/**
 * A no. The first: why, asked alone - or, with the reason already given, the
 * one offer it leaves open (the timing: a call back; not antibiotics: the
 * other products). A second clear no, or a no to that one offer, ends the call.
 */
function noMoves(s: CallState, reason: NoReason | null, offerOpen: OfferKind | null, open: OpenQuestion | null): Move[] {
  if (s.interest !== 'yes') s.interest = 'no';
  if (offerOpen) {
    s.offers[offerOpen].answer = 'no';
    // Turning down a person, with interest shown, is not turning down the offer: a call back instead.
    if (offerOpen === 'connect' && s.interest === 'yes' && s.offers.callback.answer !== 'no') return [{ move: 'offer', kind: 'callback' }];
    s.nos += 1;
  } else if (open === 'why') {
    if (reason !== 'timing' && reason !== 'product') s.nos += 1;
  } else {
    s.nos += 1;
  }
  if (s.nos >= 2) return [end('end_call', 'not_interested')];
  const door: OfferKind | null = reason === 'timing' ? 'callback' : reason === 'product' ? 'products' : null;
  if (door && s.offers[door].made === 0) return [{ move: 'offer', kind: door }];
  if (!s.whyAsked && !door) return [{ move: 'ask_why' }];
  return [end('end_call', 'not_interested')];
}

function busyAskTime(s: CallState): Move[] {
  return [...(s.busySaid ? [] : [{ move: 'busy' as const }]), { move: 'ask_time', day: s.callback.day }];
}

function misheard(s: CallState): Move[] {
  s.misheard += 1;
  if (s.misheard === 1) return [{ move: 'ask_repeat' }];
  if (s.misheard === 2 && s.offers.link.answer !== 'no') return [{ move: 'offer', kind: 'link' }];
  if (s.misheard === 2) return [{ move: 'ask_repeat' }];
  return [end('end_call', 'other')];
}

function end(action: 'end_call', reason: EndReason): Move {
  return { move: 'end', handoff: { action, reason } };
}

// ---------------------------------------------------------------------------
// A call-back time - worked out here, never by the model

const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_WORDS: Readonly<Record<string, Weekday>> = {
  sunday: 'sun',
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
};

/** The time they said, worked out on their own clock, checked, and said back - or the nearest that can be booked. */
function timeMoves(s: CallState, said: SaidTime, context: PolicyContext): Move[] {
  const day = said.day ?? s.callback.day;
  if (said.hour === null) {
    s.callback.day = day;
    return [{ move: 'ask_time', day }];
  }
  const when = resolveTime({ ...said, day }, context.leadZone, context.now);
  if (!when) {
    s.callback.day = null;
    return [{ move: 'ask_time', day: null }];
  }
  const check = checkCallbackTime(when, context.leadZone, context.hours, context.now);
  const zone = context.leadZone;
  if (check.ok) {
    return [{ move: 'confirm_time', at: when.toISOString(), zone, spoken: spokenTime(when, zone, context.now), instead: null, asked: null }];
  }
  if (!check.offer) return s.offers.link.answer === 'no' ? [end('end_call', 'other')] : [{ move: 'offer', kind: 'link' }];
  return [
    {
      move: 'confirm_time',
      at: check.offer.toISOString(),
      zone,
      spoken: spokenTime(check.offer, zone, context.now),
      instead: check.why,
      asked: spokenTime(when, zone, context.now),
    },
  ];
}

/**
 * The instant for a time said on the lead's clock: "tomorrow at 2" - a day
 * (today, tomorrow, a weekday, a date, or none: today if the time is still
 * ahead, else tomorrow), an hour with AM or PM (none: 8-11 the morning, 12
 * noon, 1-7 the afternoon). Null when it cannot be read.
 */
export function resolveTime(said: SaidTime, zone: string, now: Date): Date | null {
  if (said.hour === null || said.hour < 0 || said.hour > 23) return null;
  const minute = said.minute ?? 0;
  if (minute < 0 || minute > 59) return null;
  let hour = said.hour;
  if (hour <= 12) {
    const pm = said.ampm ? said.ampm === 'pm' : hour === 12 || hour <= 7;
    hour = pm ? (hour % 12) + 12 : hour % 12;
  }
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const today = toLocalTime(now, zone).slice(0, 10);
  const on = (date: string) => atLocalTime(`${date}T${clock}`, zone);
  const day = (said.day ?? '').trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return on(day);
  if (day === 'today') return on(today);
  if (day === 'tomorrow') return on(addDays(today, 1));
  const weekday = DAY_WORDS[day] ?? (WEEKDAYS.includes(day as Weekday) ? (day as Weekday) : undefined);
  if (weekday) {
    const todayIndex = new Date(`${today}T12:00:00Z`).getUTCDay();
    let ahead = (WEEKDAYS.indexOf(weekday) - todayIndex + 7) % 7;
    const sameDay = ahead === 0 ? on(today) : null;
    if (ahead === 0 && (!sameDay || sameDay <= now)) ahead = 7;
    return on(addDays(today, ahead));
  }
  if (day) return null;
  const sameDay = on(today);
  return sameDay && sameDay > now ? sameDay : on(addDays(today, 1));
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The call back, booked: at the time she said back and they agreed, with a reason from the record. */
function book(s: CallState, context: PolicyContext): Move {
  const reason = s.wantsSpecialist
    ? 'Has a question for a specialist.'
    : s.interest === 'yes'
      ? 'Interested in the offer; asked for a call back.'
      : 'Asked for a call back.';
  return {
    move: 'end',
    handoff: { action: 'book_callback', at: s.callback.proposed as string, timeZone: context.leadZone, reason },
  };
}

// ---------------------------------------------------------------------------
// The shape of a reply

/**
 * At most one question, and last; nothing after an ending, and no question
 * with one - an ending's line never asks (call 95).
 */
function shape(moves: Move[]): Move[] {
  const ending = moves.findIndex((m) => m.move === 'end');
  if (ending >= 0) return [...moves.slice(0, ending).filter((m) => !asks(m)), moves[ending]];
  const question = moves.findIndex(asks);
  if (question < 0) return moves;
  return [...moves.filter((m) => !asks(m)), moves[question]];
}

// ---------------------------------------------------------------------------
// What she said

/** The record once she has said `moves` - all of them, or the ones the lead heard before cutting in. */
export function markSaid(previous: CallState, moves: readonly Move[]): CallState {
  const s = copy(previous);
  s.returned = false;
  s.askedAnythingElse = false;
  for (const m of moves) {
    switch (m.move) {
      case 'opening':
        s.stage = 'talking';
        s.open = 'interest';
        break;
      case 'answer':
        s.answered[m.id] = (s.answered[m.id] ?? 0) + 1;
        break;
      case 'specialist':
        s.specialist += 1;
        break;
      case 'ask_why':
        s.whyAsked = true;
        s.open = 'why';
        break;
      case 'offer':
        s.offers[m.kind].made += 1;
        s.open = `offer_${m.kind}`;
        if (s.wrapUp === 'due') s.wrapUp = 'offered';
        break;
      case 'busy':
        s.busySaid = true;
        break;
      case 'ask_time':
        s.open = 'time';
        break;
      case 'confirm_time':
        s.callback.proposed = m.at;
        s.open = 'confirm';
        break;
      case 'return_to':
        s.returned = true;
        s.open = m.open;
        break;
      case 'anything_else':
        s.askedAnythingElse = true;
        s.open = 'anything_else';
        break;
      case 'end':
        s.stage = 'closing';
        s.open = null;
        break;
      case 'virtual':
      case 'objection':
      case 'ask_repeat':
      case 'still_here':
        break;
      default: {
        const never: never = m;
        throw new Error(`a move the record does not know: ${JSON.stringify(never)}`);
      }
    }
  }
  // A reply that asked nothing leaves her open question as it was; one that answered it closes it.
  return s;
}

/** The three minutes are up: her next reply makes the closing offer (A12). */
export function wrapUpDue(previous: CallState): CallState {
  return previous.wrapUp === 'not_yet' ? { ...copy(previous), wrapUp: 'due' } : previous;
}

/** How her reply began, kept for the next (A29): its first two words. */
export function markOpening(previous: CallState, said: string): CallState {
  const start = said.trim().split(/\s+/).slice(0, 2).join(' ').replace(/[,.!?]+$/, '');
  if (!start) return previous;
  return { ...copy(previous), openings: [...previous.openings, start].slice(-2) };
}
