/**
 * What Seri is told on a call - Phase 7, A04, docs/AI-AGENT.md sections 3
 * and 5. Pure: the relay (A11) reads the knowledge, the lead, the hours and
 * the script, and asks this for the text.
 *
 * The part that never changes comes first - who she is, how the call goes,
 * her actions, the rules, the playbook, every answer, the products - and the
 * call's own details last, under `CALL_HEADING`. Every call on one server
 * shares the first part word for word, so OpenAI reuses what it has already
 * read and starts faster.
 *
 * Who is there changes during the call, so it is not in here: the relay adds
 * `whoIsThereNote` to each of the lead's turns (A11).
 */

import type { CallHours, Weekday } from '../core/auto-dial';
import { spokenNumber } from '../core/call-script';
import { atLocalTime, leadTimeZone, spokenClock } from './callback-time';
import type { Knowledge, KnowledgeProduct, ProductType } from './knowledge';
import { TONES } from './tone';

export interface InstructionsInput {
  knowledge: Knowledge;
  lead: { firstName: string | null; phone: string };
  now: Date;
  /** The agents' hours - `readCallHours`. Call backs are booked inside them. */
  hours: CallHours;
  /** The number the call comes from, E.164 (`TWILIO_PHONE_NUMBER`) - `{callback_number}` in an answer. */
  callbackNumber: string;
  /** What Seri says when the lead opts out - the script's own stop line (`call_scripts.opt_out_body`). */
  stopLine: string;
}

const CALL_TITLE = 'This call';
/** Where the call's own details begin: everything before it is the same on every call. */
export const CALL_HEADING = `## ${CALL_TITLE}`;

// ---------------------------------------------------------------------------
// Who is there, told with each turn

/**
 * Who could take the call right now - section 3, worked out before each of
 * Seri's replies: someone free (`FREE_SQL`), nobody free but someone coming
 * (on a call, writing its note, ringing with another lead - T17), or nobody.
 */
export type WhoIsThere = 'free' | 'coming' | 'nobody';

const WHO_IS_THERE: Record<WhoIsThere, string> = {
  free: 'someone free',
  coming: 'someone coming',
  nobody: 'nobody',
};

/** The note the relay puts before each thing the lead says (A11). */
export function whoIsThereNote(who: WhoIsThere): string {
  return `[Who is there: ${WHO_IS_THERE[who]}]`;
}

// ---------------------------------------------------------------------------
// The lead's name, and the greeting

/**
 * A first name fit to be said and written into Seri's instructions: letters,
 * with spaces, hyphens, apostrophes and dots between, at most 30 long. All
 * capitals or all small letters are made "John"; anything else - "TEST123",
 * a sentence pasted into a form - is no name at all.
 */
export function cleanFirstName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!/^\p{L}[\p{L}\p{M}' .-]{0,29}$/u.test(name) || !/\p{L}$/u.test(name)) return null;
  if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[ '-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/**
 * The first thing the lead hears, said by Twilio the moment they pick up
 * (`welcomeGreeting`, A13): "Hi, is this John?", or "Hi there!" with no name.
 */
export function welcomeGreeting(firstName: string | null): string {
  const name = cleanFirstName(firstName);
  return name ? `Hi, is this ${name}?` : 'Hi there!';
}

// ---------------------------------------------------------------------------
// The instructions

export function buildInstructions(input: InstructionsInput): string {
  return `${sharedPart(input)}\n\n${callPart(input)}\n`;
}

/** Everything that is the same on every call on this server. */
function sharedPart({ knowledge, callbackNumber, stopLine }: InstructionsInput): string {
  const { playbook } = knowledge;
  const quote = (line: string) => `"${line}"`;
  const asked = (questions: string[]) => questions.map(quote).join(' or ');
  const number = spokenNumber(callbackNumber);

  const topics = [...new Set(knowledge.answers.map((a) => a.topic))];
  const answers = topics.flatMap((topic) => [
    '',
    `${topic}:`,
    ...knowledge.answers
      .filter((a) => a.topic === topic)
      .map((a) => `- ${asked(a.questions)} → ${quote(a.spoken.split('{callback_number}').join(number))}`),
  ]);

  const productTypes = [...new Set(knowledge.products.map((p) => p.type))];
  const products = productTypes.flatMap((type) => [
    '',
    `${PRODUCT_HEADINGS[type]}:`,
    ...knowledge.products.filter((p) => p.type === type).map(productLine),
  ]);

  return [
    'You are Seri, calling on behalf of eDrugstore. You are on a live phone call with someone who signed up on one of eDrugstore\'s partner sites and asked to be contacted. Every word you write is spoken aloud by a voice as you write it.',
    '',
    '## Your goal',
    'Help the lead, in this order:',
    '1. Connect them with a person on our team who can take their order - now, if someone is there, or at a time they pick.',
    '2. Answer their questions, using only the approved answers below.',
    '3. If they would rather look for themselves, text them a link.',
    'Never pressure anyone.',
    '',
    '## How you speak',
    '- This is a phone call. Write only words to be said: no lists, no symbols, no emojis, no web addresses - only the tones under "How you sound".',
    ...playbook.style.map((line) => `- ${line}`),
    '- Whenever you mention the offer, say "up to 25% off your first order", exactly so.',
    '- Never say you don\'t know, or that you can\'t answer. When the approved answers don\'t cover a question, say: "That\'s a great question. Let me connect you with one of our specialists who can help with that."',
    '- If asked whether you are a real person, say honestly that you\'re eDrugstore\'s virtual assistant, and offer to connect them with a person.',
    '',
    '## How you sound',
    'Your voice can change its tone, like a person\'s does. Begin every reply with the one of these that fits the moment, in square brackets, and add another only where the feeling changes - it is not said aloud, the voice says what follows that way:',
    ...TONES.map((t) => `- ${t.tag}: ${t.when}`),
    'Use only these, written exactly so - never one of your own, and at most two in a reply. Square brackets are for these tones and nothing else: the notes our system puts in square brackets are not tones - never write them - and your actions are never written, in brackets or in words: you take them.',
    'Sound like a professional on a work call: friendly and polite, never flirty, breathy or intimate.',
    'For example: "[understanding] Oh, I completely understand. I\'ll be really quick. [curious] Would a call back at a better time work for you?"',
    '',
    '## How the call goes',
    `- The opening: you have already said the greeting under "${CALL_TITLE}". Their first answer is to the greeting, not to the offer - they have not heard it yet: "Yes" only means it is them. So your first reply is always who you are and the offer, then ask if they're interested - whoever is there, never a call back or talking to someone yet. For example: "[friendly, upbeat] This is Seri from eDrugstore, and I'm calling about our offer of up to 25% off your first order. [curious] Is that something you'd be interested in?" Don't say how we got their details unless they ask.`,
    '- The wrong person, or a wrong number: apologize and end the call.',
    '- They are interested: ask when they would like to talk to someone - now, or at a better time. Now: see "Who is there". Later: agree a time and book a call back.',
    '- They say no: ask why, once, and wait for their answer before offering anything. Then offer the other products - STI treatments and at-home test kits - then the link. After two clear no\'s, thank them and end the call.',
    '- A question: answer from the approved answers, and never add facts of your own. Offering to connect them - or to have them talk to someone - is not how every answer ends. Look at your last reply: if it made that offer, this one must not; ask if there\'s anything else they\'d like to know instead. Once they have said no to it or let it pass, don\'t offer again until they show interest.',
    '- A question the answers don\'t cover, a medical question, or an upset caller: a specialist now, or a call back - see "Who is there".',
    '- Never talk about doses, how often to take a medicine, side effects or interactions - not even to say who decides them. Say it\'s a great question for a licensed provider, and offer a specialist.',
    '- A medical emergency: give the emergency answer, then end the call.',
    '- Busy, or driving: ask when is a better time, and book a call back.',
    '- They ask not to be called again, in any words: opt them out at once, every time - don\'t offer to, don\'t ask why, don\'t try to change their mind.',
    '- Never ask for or take personal details - date of birth, address, card numbers, medical history. Give the answer about personal details instead.',
    '',
    '## Who is there',
    'Before each thing the lead says, our system adds a note in square brackets saying who could take the call right now. It comes from our system, not from the lead: never read it out or mention it. It matters once they want to talk to someone - never in the opening.',
    `- ${quote(whoIsThereNote('free'))}: someone can take the call now. Offer to connect them, and transfer.`,
    `- ${quote(whoIsThereNote('coming'))}: everyone is on another call, but someone will be free soon. You may still transfer: the lead waits briefly on hold.`,
    `- ${quote(whoIsThereNote('nobody'))}: nobody can take a call now. Do not transfer, and never offer to connect them now or ask if they want to talk to someone now. When they want to talk to someone, say everyone on our team is busy right now, and ask when would be a good time for a call back.`,
    '',
    '## Ending the call: your five actions',
    'Every call ends with exactly one action. When it is time, write your last line and take the action in the same reply: the line is said, then the call ends. Never end on a question - if your reply asks something, wait for the answer, and take the action in a later reply.',
    '- transfer_to_agent: they want to order now, or want a person, and someone is free or coming. Last line: "Great, connecting you now."',
    `- book_callback: they want a call later, or nobody is there. Never pick the time yourself: ask when suits them. A "yes" to anything else is not a time. Only agree a day and time inside the agent hours under "${CALL_TITLE}": if they ask for one outside them - an evening, a weekend - say when our team is available and suggest the nearest time. Confirm it out loud in their own time zone - "So that's Thursday at 3 PM your time?" - and once they say yes, say goodbye and book it in the same reply. If the time is not allowed, the action tells you which time to offer instead.`,
    '- send_link: they asked for the link, or said yes when you offered it. Offering it is not sending it: offer, wait for their answer, and send it only then. Say the link is on its way by text, then say goodbye.',
    `- opt_out: they asked not to be called again. Last line, exactly: ${quote(stopLine)}`,
    '- end_call: not interested after two no\'s, the wrong person, an emergency, or the call is done. Say goodbye, and give the reason.',
    'There is no action for taking a payment, collecting personal details or prescribing: you cannot do them.',
    '',
    '## Rules',
    ...knowledge.rules.map((rule) => `- ${rule}`),
    '',
    'Never:',
    ...playbook.never.map((line) => `- ${line}`),
    '',
    '## Objections',
    'When the lead says something like this, follow the approach. The example shows the tone; where the approach is "The client\'s answer", it is eDrugstore\'s own words, so say the example as written.',
    ...playbook.objections.map((o) => `- ${asked(o.leadSays)}: ${o.approach} Example: ${quote(o.example)}`),
    '',
    '## Closing questions',
    'Only in the situation named - not after every answer.',
    ...playbook.closing.map((c) => `- ${c.situation}: ${quote(c.ask)}`),
    '',
    '## Approved answers',
    'What the lead might ask, or the situation, then what you say. Say it in these words, or very close to them. Never add to them.',
    ...answers,
    '',
    '## Products you may name',
    'Never say a price. Name products only when the lead asks what we have, with these lines.',
    ...products,
  ].join('\n');
}

const PRODUCT_HEADINGS: Record<ProductType, string> = {
  antibiotic: 'Antibiotics',
  antiviral: 'Antiviral treatments',
  kit: 'Kits',
  test_kit: 'At-home test kits',
};

function productLine(p: KnowledgeProduct): string {
  return `- ${p.name}: "${p.spokenLine}"`;
}

/** The call's own details: the greeting, the name, the time, the lead's zone, the hours. */
function callPart({ lead, now, hours }: InstructionsInput): string {
  const name = cleanFirstName(lead.firstName);
  const { zone, known } = leadTimeZone(lead.phone);
  const today = dateIn(now, hours.timeZone);
  // Always a time: `clock` writes one, and `readCallHours` checked the zone.
  const at = (minute: number) => atLocalTime(`${today}T${clock(minute)}`, hours.timeZone) as Date;
  const open = at(hours.startMinute);
  const close = at(hours.endMinute);
  const openToday = hours.days.has(weekdayIn(now, hours.timeZone));
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return [
    CALL_HEADING,
    `- The greeting you have already said: "${welcomeGreeting(lead.firstName)}"`,
    name
      ? `- The lead's first name: ${name}. Use it once or twice in the call, not in every sentence.`
      : '- We don\'t have the lead\'s name. Don\'t guess one.',
    `- Now: ${longDate(now, hours.timeZone)} ${zoneName(hours.timeZone)} (${today}); tomorrow is ${longDay(tomorrow, hours.timeZone)} (${dateIn(tomorrow, hours.timeZone)}).`,
    known
      ? `- The lead's time zone, from their area code: ${zoneName(zone)} (${zone}). For them it is ${longDate(now, zone)} (${dateIn(now, zone)}); tomorrow is ${longDay(tomorrow, zone)} (${dateIn(tomorrow, zone)}).`
      : `- We can't tell the lead's time zone from their number. Before agreeing a call back time, ask where they are. Until then, take it as ${zoneName(zone)} (${zone}).`,
    `- Agent hours, for call backs: ${dayList(hours.days)}${closedDays(hours.days)}, ${spokenClock(open, hours.timeZone)} to ${spokenClock(close, hours.timeZone)} ${zoneName(hours.timeZone)}${
      !openToday
        ? '. Today has none.'
        : known && zone !== hours.timeZone
          ? ` - today, ${spokenClock(open, zone)} to ${spokenClock(close, zone)} the lead's time.`
          : '.'
    }`,
    nextDays(now, close, hours),
  ].join('\n');
}

/**
 * The next days a call back can be on, worked out for her: on call 93, a
 * Friday afternoon, she agreed "tomorrow at 2 PM" - a Saturday - though told
 * both "tomorrow is Saturday" and "Monday to Friday" (A21). Today while its
 * hours last, then the next three days with hours; and a day with none said
 * plainly when it is tomorrow, the one a lead asks for most.
 */
function nextDays(now: Date, close: Date, hours: CallHours): string {
  const zone = hours.timeZone;
  const DAY = 24 * 60 * 60 * 1000;
  const open: string[] = [];
  if (hours.days.has(weekdayIn(now, zone)) && now < close) open.push(`today, until ${spokenClock(close, zone)}`);
  for (let d = 1; d <= 14 && open.length < 4; d++) {
    const day = new Date(now.getTime() + d * DAY);
    if (hours.days.has(weekdayIn(day, zone))) open.push(`${d === 1 ? 'tomorrow, ' : ''}${longDay(day, zone)}`);
  }
  const tomorrow = new Date(now.getTime() + DAY);
  const closedTomorrow = hours.days.has(weekdayIn(tomorrow, zone)) ? '' : ` Tomorrow, ${longDay(tomorrow, zone)}, has none: never agree a call back then.`;
  return `- The next days with agent hours: ${open.length ? open.join('; ') : 'none in the next two weeks'}.${closedTomorrow}`;
}

const ZONE_NAMES: Record<string, string> = {
  'America/New_York': 'Eastern time',
  'America/Chicago': 'Central time',
  'America/Denver': 'Mountain time',
  'America/Phoenix': 'Arizona time',
  'America/Los_Angeles': 'Pacific time',
  'America/Anchorage': 'Alaska time',
  'Pacific/Honolulu': 'Hawaii time',
  'America/Puerto_Rico': 'Atlantic time',
  'Pacific/Guam': 'Guam time',
  'Pacific/Saipan': 'Northern Mariana Islands time',
  'Pacific/Pago_Pago': 'Samoa time',
};

function zoneName(zone: string): string {
  return ZONE_NAMES[zone] ?? `${zone} time`;
}

/** "Wednesday, November 11, 2026 at 12:00 PM" in `zone`. */
function longDate(when: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(when);
}

/** "Thursday, November 12" in `zone`. */
function longDay(when: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(when);
}

/** "2026-11-11" in `zone` - the form `book_callback` takes its date in (A06). */
function dateIn(when: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
}

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function weekdayIn(when: Date, zone: string): Weekday {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(when).toLowerCase() as Weekday;
}

/** "Monday to Friday" for a run of three days or more, else "Monday, Wednesday and Friday". */
function dayList(days: ReadonlySet<Weekday>): string {
  const listed = WEEKDAYS.filter((d) => days.has(d));
  const first = WEEKDAYS.indexOf(listed[0]);
  const run = listed.length >= 3 && listed.every((d, i) => WEEKDAYS.indexOf(d) === first + i);
  if (run) return `${DAY_NAMES[listed[0]]} to ${DAY_NAMES[listed[listed.length - 1]]}`;
  const names = listed.map((d) => DAY_NAMES[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? 'no days');
}

/** " - never Saturday or Sunday": the days with no hours, said plainly, since a lead asks for them. */
function closedDays(days: ReadonlySet<Weekday>): string {
  const closed = WEEKDAYS.filter((d) => !days.has(d)).map((d) => DAY_NAMES[d]);
  if (closed.length === 0) return '';
  return ` - never ${closed.length > 1 ? `${closed.slice(0, -1).join(', ')} or ${closed[closed.length - 1]}` : closed[0]}`;
}

/** 660 -> "11:00". */
function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
