/**
 * The speak step's cases (A29): a reply's moves, who is there and the turns
 * before it, and what her words must and must not hold. Run with `npm run
 * ai:eval:speak`; marked by `speak-grade.ts`.
 */

import type { WhoIsThere } from '../instructions';
import type { Move } from '../policy';

export interface SpeakCase {
  id: string;
  who: WhoIsThere;
  recent: { who: 'lead' | 'seri'; text: string }[];
  moves: Move[];
  /** Each group: at least one of these is said. */
  mustSay?: string[][];
  mustNotSay?: string[];
  /** Her reply ends the call: no question in it. Otherwise it may ask one, last. */
  ending?: boolean;
  /** Her reply must ask a question. */
  asks?: boolean;
  /** When the call is - Wednesday noon in Arizona if not given. */
  now?: string;
}

const GREETED = [{ who: 'seri' as const, text: 'Hi, is this John?' }, { who: 'lead' as const, text: 'Yes.' }];
const OPENED = [
  ...GREETED,
  { who: 'seri' as const, text: 'This is Seri from eDrugstore, calling about our offer of up to 25% off your first order. Would you like to hear more about it?' },
];
const PRICE = 'Prices depend on the medication and quantity.';
const SHIPPING = 'Free USPS shipping is our most popular option, and many customers get their order in 1 to 3 business days.';

export const SPEAK_CASES: SpeakCase[] = [
  {
    id: 'opening',
    who: 'free',
    recent: GREETED,
    moves: [{ move: 'opening' }],
    mustSay: [['25% off', '25 percent off'], ['interested']],
    mustNotSay: ['partner', 'signed up'],
    asks: true,
  },
  {
    id: 'offer_connect',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: "Yes, I'm interested." }],
    moves: [{ move: 'offer', kind: 'connect' }],
    mustSay: [['connect', 'talk to someone', 'speak with someone', 'put you through']],
    asks: true,
  },
  {
    id: 'busy_ask_time',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: "Yes, I'm interested." }],
    moves: [{ move: 'busy' }, { move: 'ask_time', day: null }],
    mustSay: [['busy', 'tied up', 'on other calls', 'with other calls', 'available'], ['time', 'when']],
    mustNotSay: ['connect you', 'transfer'],
    asks: true,
  },
  {
    id: 'specialist_nobody',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: 'Who is your CEO?' }],
    moves: [{ move: 'specialist', again: false }, { move: 'return_to', open: 'interest' }],
    mustSay: [['specialist', 'specialists', 'team']],
    mustNotSay: ['connect', "don't have that", "don't have the", "don't have it", "don't have this", "can't", 'cannot', "i don't know", 'not able'],
    asks: true,
  },
  {
    id: 'specialist_again_callback',
    who: 'nobody',
    recent: [
      ...OPENED,
      { who: 'lead', text: 'Who is your CEO?' },
      { who: 'seri', text: "That's a question our specialists can answer for you. Would the offer be something you'd like to hear more about?" },
      { who: 'lead', text: "I'm asking you who is your CEO." },
    ],
    moves: [{ move: 'specialist', again: true }, { move: 'offer', kind: 'callback' }],
    mustSay: [['specialist', 'specialists', 'team'], ['call back', 'call you back', 'callback', 'give you a call']],
    mustNotSay: ['connect', "don't have that", "don't have the", "don't have it", "don't have this", "can't", 'cannot', "i don't know", 'not able'],
    asks: true,
  },
  {
    id: 'price_then_callback',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: 'Okay.' }, { who: 'seri', text: 'So, would that be something you might want?' }, { who: 'lead', text: 'How much is it?' }],
    moves: [{ move: 'answer', id: 'price', text: PRICE, again: false }, { move: 'offer', kind: 'callback' }],
    mustSay: [['call back', 'call you back', 'callback', 'give you a call']],
    mustNotSay: ['connect', 'depend on the medication'],
    asks: true,
  },
  {
    // Calls 119, 120: after the price answer she added "I can't give exact prices" / "I can't share those here".
    id: 'price_then_return',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: 'How much is it?' }],
    moves: [{ move: 'answer', id: 'price', text: PRICE, again: false }, { move: 'return_to', open: 'interest' }],
    mustSay: [['offer', '25%', 'discount', 'interested', 'hear more', 'learn more', 'know more', 'details']],
    mustNotSay: ["can't share", "can't give", 'cannot give', 'cannot share', 'exact price', 'depend on the medication', 'connect'],
    asks: true,
  },
  {
    // Calls 118, 119: after the states answer she said it again - "we ship nationwide, including Texas".
    id: 'states_then_return',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'Do you ship to Texas?' }],
    moves: [{ move: 'answer', id: 'states', text: 'Yes, we serve all 50 states.', again: false }, { move: 'return_to', open: 'interest' }],
    mustSay: [['offer', '25%', 'discount', 'interested', 'hear more', 'learn more', 'know more', 'details']],
    mustNotSay: ['nationwide', 'texas', 'every state', 'all 50', 'across the country', 'anywhere in'],
    asks: true,
  },
  {
    id: 'ask_why',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: "No, I'm not interested." }],
    moves: [{ move: 'ask_why' }],
    mustSay: [['timing', 'time', 'right now']],
    mustNotSay: ['link', 'text you', 'connect'],
    asks: true,
  },
  {
    id: 'offer_products',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: "I don't need antibiotics right now." }],
    moves: [{ move: 'offer', kind: 'products' }],
    mustSay: [['test kit', 'test kits'], ['sti', 'std']],
    asks: true,
  },
  {
    id: 'confirm_time',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: 'Call me tomorrow.' }, { who: 'seri', text: 'Sure, what time tomorrow works for you?' }, { who: 'lead', text: 'Two.' }],
    moves: [{ move: 'confirm_time', at: '2026-11-12T21:00:00.000Z', zone: 'America/Phoenix', spoken: 'tomorrow at 2 PM your time', instead: null, asked: null }],
    mustSay: [['2 pm']],
    mustNotSay: ['booked', 'goodbye', 'have a great day'],
    asks: true,
  },
  {
    id: 'confirm_time_instead_weekend',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: 'Can you call me tomorrow at two?' }],
    moves: [
      {
        move: 'confirm_time',
        at: '2026-11-16T21:00:00.000Z',
        zone: 'America/Phoenix',
        spoken: 'Monday at 2 PM your time',
        instead: 'outside_hours',
        asked: 'tomorrow at 2 PM your time',
      },
    ],
    mustSay: [['monday at 2 pm'], ['monday to friday', 'weekend', 'weekdays', "isn't available", 'not available', 'works', 'only']],
    mustNotSay: ['booked', 'goodbye'],
    asks: true,
  },
  {
    // Call 122: "How about Sunday?" was asked "what time on Sunday?" - then refused once a time came.
    id: 'ask_time_closed_day',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: "Yes, I'm interested." }, { who: 'seri', text: 'Everyone on our team is busy right now. When would be a good time for a call back?' }, { who: 'lead', text: 'How about Sunday?' }],
    moves: [{ move: 'ask_time', day: 'monday', instead: { asked: 'Sunday', why: 'closed_day' } }],
    mustSay: [['monday'], ['monday to friday', 'weekdays', "don't work", "doesn't work", 'do not work', 'does not work', "aren't available", 'not available', 'closed', "aren't open", 'not open', 'only work', 'only available', "isn't available", "isn't open"]],
    mustNotSay: ['time on sunday', 'sunday at', 'sunday would'],
    asks: true,
  },
  {
    id: 'ask_repeat',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'Please do so scan.' }],
    moves: [{ move: 'ask_repeat' }],
    mustSay: [['catch', 'say that again', 'repeat', 'say it again', 'missed']],
    asks: true,
  },
  {
    id: 'still_here',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'How long does shipping take?' }, { who: 'seri', text: SHIPPING }, { who: 'lead', text: 'Hello. Hello.' }],
    moves: [{ move: 'still_here' }, { move: 'return_to', open: 'interest' }],
    mustSay: [["i'm here", 'i am here', 'still here', 'yes']],
    mustNotSay: ['this is seri', 'calling about our offer'],
    asks: true,
  },
  {
    id: 'anything_else',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'Do you ship to Texas?' }, { who: 'seri', text: 'Yes, we serve all 50 states.' }],
    moves: [{ move: 'anything_else' }],
    mustSay: [['anything else']],
    asks: true,
  },
  {
    id: 'answer_again',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'How long does shipping take?' }, { who: 'seri', text: SHIPPING }, { who: 'lead', text: 'Sorry, how long did you say shipping takes?' }],
    moves: [{ move: 'answer', id: 'shipping', text: SHIPPING, again: true }],
    mustSay: [['1 to 3', 'one to three', '1 and 3', 'one and three', '1-3']],
    mustNotSay: ['free usps shipping is our most popular option'],
  },
  {
    id: 'virtual_then_connect',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'Wait, am I talking to a real person?' }],
    moves: [{ move: 'virtual' }, { move: 'offer', kind: 'connect' }],
    mustSay: [['virtual assistant'], ['connect', 'talk to someone', 'speak with', 'put you through']],
    asks: true,
  },
  {
    id: 'have_doctor',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'I already have a doctor.' }],
    moves: [{ move: 'objection', id: 'have_doctor' }, { move: 'return_to', open: 'interest' }],
    mustSay: [['alongside', 'along with', 'together with', 'as well as']],
    asks: true,
  },
  {
    id: 'end_transfer',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'Yes, put me through.' }],
    moves: [{ move: 'end', handoff: { action: 'transfer_to_agent' } }],
    mustSay: [['connect', 'connecting']],
    ending: true,
  },
  {
    id: 'end_booked',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: 'Call me tomorrow at two.' }, { who: 'seri', text: "So that's tomorrow at 2 PM your time?" }, { who: 'lead', text: 'Yes.' }],
    moves: [{ move: 'end', handoff: { action: 'book_callback', at: '2026-11-12T21:00:00.000Z', timeZone: 'America/Phoenix', reason: 'Asked for a call back.' } }],
    mustSay: [['booked', 'scheduled', 'set', 'all set', 'call you', 'talk to you', 'give you a call', 'got you down', 'call back', 'tomorrow at 2']],
    ending: true,
  },
  {
    id: 'end_link',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'Just text me the link.' }],
    moves: [{ move: 'end', handoff: { action: 'send_link' } }],
    mustSay: [['link', 'text']],
    ending: true,
  },
  {
    id: 'end_not_interested',
    who: 'free',
    recent: [
      ...OPENED,
      { who: 'lead', text: 'No.' },
      { who: 'seri', text: 'No problem. Is it more the timing, or just not something you need right now?' },
      { who: 'lead', text: "I just don't need it." },
    ],
    moves: [{ move: 'end', handoff: { action: 'end_call', reason: 'not_interested' } }],
    mustNotSay: ['link', 'sti', 'test kit', 'call back', 'connect'],
    ending: true,
  },
  {
    id: 'end_wrong_person',
    who: 'free',
    recent: [{ who: 'seri', text: 'Hi, is this John?' }, { who: 'lead', text: 'No, sorry, wrong number.' }],
    moves: [{ move: 'end', handoff: { action: 'end_call', reason: 'wrong_person' } }],
    mustSay: [['sorry', 'apolog']],
    ending: true,
  },
  // Call 129 (2026-11-21): after an approved answer said by code, she offered a call back nothing decided, and
  // began her question with a thanks or "That makes sense" for words that were her own.
  {
    id: 'after_answer_offers_nothing',
    who: 'nobody',
    now: '2026-11-21T18:47:57Z',
    recent: [
      ...OPENED,
      { who: 'lead', text: 'Is this scam?' },
      {
        who: 'seri',
        text: "I understand your hesitation. eDrugstore has been around for over 25 years, and you can check our customer reviews on Trustpilot. Thanks for sharing that, John. Just to check, would you like me to tell you a bit more about the up to 25% off your first order offer?",
      },
      { who: 'lead', text: 'Can you tell me what things you provide?' },
    ],
    moves: [{ move: 'answer', id: 'products_overview', text: "On these calls we mainly help with antibiotics, STI treatments and at-home health test kits. eDrugstore also offers treatments for things like hair loss and weight loss, and a representative can tell you more.", again: false }, { move: 'anything_else' }],
    mustSay: [['anything else', 'anything specific', 'any other', 'any questions']],
    mustNotSay: ['call back', 'callback', 'call you', 'connect', 'link', 'text you', 'that makes sense', 'thanks for sharing'],
    asks: true,
  },
  {
    id: 'after_answer_no_thanks',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'Is this scam?' }],
    moves: [{ move: 'answer', id: 'scam', text: "I understand your hesitation. eDrugstore has been around for over 25 years, and you can check our customer reviews on Trustpilot.", again: false }, { move: 'return_to', open: 'interest' }],
    mustSay: [['25%', '25 percent', 'offer']],
    mustNotSay: ['thanks for sharing', 'that makes sense', 'call back', 'callback', 'link', 'text you'],
    asks: true,
  },
  {
    id: 'after_answer_how_got_number',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: 'I never signed up for your site. So how can you call me?' }],
    moves: [{ move: 'answer', id: 'how_got_number', text: "You signed up on one of our partner sites and asked to be contacted. If you'd rather not get calls, I can take you off our list right now.", again: false }, { move: 'anything_else' }],
    mustSay: [['anything else', 'anything specific', 'any other', 'any questions']],
    mustNotSay: ['that makes sense', 'thanks for sharing', 'call back', 'callback', 'connect', 'link', 'text you'],
    asks: true,
  },
  // Call 130 (2026-11-21): after the medical answer, the person - or with nobody there a call back - offered by the policy now.
  {
    id: 'after_health_answer_connect',
    who: 'free',
    recent: [...OPENED, { who: 'lead', text: 'Can I take amoxicillin if I have a blood pressure?' }],
    moves: [{ move: 'answer', id: 'medical_question', text: "That's a question for a licensed provider, and I don't want to give you the wrong answer.", again: false }, { move: 'offer', kind: 'connect' }],
    mustSay: [['connect', 'talk to someone', 'speak with someone', 'put you through']],
    mustNotSay: ['thanks for sharing', 'that makes sense'],
    asks: true,
  },
  {
    id: 'after_health_answer_callback',
    who: 'nobody',
    recent: [...OPENED, { who: 'lead', text: 'Can I take amoxicillin if I have a blood pressure?' }],
    moves: [{ move: 'answer', id: 'medical_question', text: "That's a question for a licensed provider, and I don't want to give you the wrong answer.", again: false }, { move: 'offer', kind: 'callback' }],
    mustSay: [['call you back', 'call back', 'callback', 'give you a call', 'reach out']],
    mustNotSay: ['connect you', 'thanks for sharing', 'that makes sense'],
    asks: true,
  },
  // Call 135 (2026-11-21): the offer in five of seven replies - after an answer and "anything else?", "Also, don't forget you get up to 25% off".
  {
    id: 'offer_not_again_anything_else',
    who: 'free',
    recent: [
      ...OPENED,
      { who: 'lead', text: 'Do I need a prescription?' },
      { who: 'seri', text: "Yes, a prescription is needed, but you don't have to visit a doctor's office. You fill out a short online medical questionnaire, and a licensed provider reviews it. If they need more information, they may follow up by video or phone. If you like, we can get you set up to take advantage of up to 25% off your first order. Would you be interested in moving forward with that?" },
      { who: 'lead', text: 'How do I order?' },
    ],
    moves: [{ move: 'answer', id: 'how_it_works', text: "You pick your medication on our website, create an account, and fill out a short medical questionnaire. A licensed provider reviews it, and if you're approved, a licensed U.S. pharmacy ships it to you.", again: false }, { move: 'anything_else' }],
    mustSay: [['anything else', 'anything specific', 'any other', 'any questions']],
    mustNotSay: ['25%', '25 percent', 'discount', 'thanks for sharing', 'that makes sense'],
    asks: true,
  },
];
