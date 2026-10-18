/**
 * The automated call's script as migration 015 seeds it, for tests - so the
 * words and lines a test uses are the ones a lead hears. Not used by the app,
 * which loads the script from the database (`db/call-script.ts`).
 * `scripts/call-script-live-check.ts` compares this with the database, so the
 * two cannot drift apart.
 */

import type { CallScript } from './call-script';

export const OFFER_STEP = 1;
export const LINK_STEP = 2;

const ASK_AGAIN = "Sorry, I didn't catch that. Press 1 for yes, 2 for no, or 9 to stop these calls.";

export const ANTIBIOTICS_CALL: CallScript = {
  id: 1,
  key: 'antibiotics',
  name: 'eDrugstore antibiotics',
  voice: 'Polly.Joanna-Neural',
  optOutWords: ['stop calling', 'stop', 'remove me', 'take me off', 'do not call', "don't call", 'unsubscribe'],
  optOutBody: "Okay, we won't call you again. Goodbye.",
  noResponseBody: 'Thank you for your time. Have a great day.',
  voicemailBody:
    "Hi, this is Seri calling from eDrugstore with a quick message - we're offering antibiotics at 25% off right now. We'd love to connect. Please call us back at {callback_number}. Thanks, and have a great day!",
  busyBody: 'All our agents are busy right now. An agent will call you back shortly.',
  holdBody: 'All our agents are on other calls. Please stay on the line.',
  linkText:
    'eDrugstore: Here is your link to see our medications at discount prices: https://www.edrugstore.com/anti-ez Reply STOP to opt out.',
  steps: [
    {
      id: OFFER_STEP,
      key: 'q1',
      position: 10,
      heading: 'Offer',
      body: 'Hi, this is Seri calling from eDrugstore. This is an automated call. Are you interested in ordering antibiotics at 25% off today?',
      repeatBody: ASK_AGAIN,
      choices: [
        {
          key: '1',
          label: 'Yes',
          words: ['yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'interested', 'of course', 'absolutely', 'definitely'],
          reply: 'Great, connecting you with a live agent now. Please hold.',
          nextStepId: null,
          ending: 'transfer',
        },
        {
          key: '2',
          label: 'No',
          words: ['no', 'nope', 'nah', 'not interested', 'no thanks', 'no thank you', 'not really', 'not now', 'not today'],
          reply: "No problem - I'll just ask one more quick thing.",
          nextStepId: LINK_STEP,
          ending: null,
        },
      ],
    },
    {
      id: LINK_STEP,
      key: 'q2',
      position: 20,
      heading: 'Link',
      body: 'Can we send you a link to see all our medication at discount prices?',
      repeatBody: ASK_AGAIN,
      choices: [
        {
          key: '1',
          label: 'Yes',
          words: ['yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'of course', 'absolutely', 'definitely', 'send it', 'send me', 'text me'],
          reply: "Perfect. Check your SMS. Thanks! You'll get the link shortly. Have a great day.",
          nextStepId: null,
          ending: 'send_link',
        },
        {
          key: '2',
          label: 'No',
          words: ['no', 'nope', 'nah', 'not interested', 'no thanks', 'no thank you', 'not really', "don't text", 'do not text', 'no text'],
          reply: 'Thank you for your time. Have a great day.',
          nextStepId: null,
          ending: 'declined',
        },
      ],
    },
  ],
};
