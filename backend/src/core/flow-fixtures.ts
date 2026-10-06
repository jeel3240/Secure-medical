/**
 * The antibiotics flow as migration 012 seeds it, for tests - so the numbers
 * and the wording in a test are the ones a lead meets. Not used by the app,
 * which loads flows from the database (`db/flows.ts`).
 */

import type { Flow, Rules } from './state-machine';

export const Q1 = 11;
export const Q2 = 12;
export const Q3 = 13;
export const OFFERS = 14;

const YES = ['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'correct'];
const NO = ['no', 'n', 'nope', 'nah', 'no thanks'];
export const LINK = 'https://www.edrugstore.com/anti-ez';

export const ANTIBIOTICS: Flow = {
  id: 2,
  key: 'antibiotics',
  respondedPoints: 10,
  completedPoints: 10,
  reviewBody: 'Thanks! An eDrugstore representative will follow up with you directly.',
  questions: [
    {
      id: Q1,
      key: 'q1',
      position: 1,
      body: 'eDrugstore: Hi {first_name}, did you recently request more info about ordering antibiotics online? Reply 1. Yes, 2. No. Reply STOP to opt out.',
      clarifyBody: 'Sorry, please reply 1 for Yes or 2 for No.',
      heading: 'Requested info',
      choices: [
        { choice: '1', label: 'Yes', words: YES, points: 20, reply: "Great! Let's get you started.", nextQuestionId: Q2, ending: null },
        { choice: '2', label: 'No', words: NO, points: 0, reply: 'No problem.', nextQuestionId: OFFERS, ending: null },
      ],
    },
    {
      id: Q2,
      key: 'q2',
      position: 2,
      body: 'Have you used telemedicine to get prescription medication before? Reply 1. Yes, 2. No.',
      clarifyBody: 'Sorry, please reply 1 for Yes or 2 for No.',
      heading: 'Used telemedicine',
      choices: [
        { choice: '1', label: 'Yes', words: ['yes', 'y', 'yeah', 'yep', 'yup', 'i have'], points: 15, reply: 'Great. eDrugstore makes the online consultation process simple.', nextQuestionId: Q3, ending: null },
        { choice: '2', label: 'No', words: ['no', 'n', 'nope', 'nah', 'never', 'not yet'], points: 5, reply: 'No problem. You can complete your information online and, when required, consult with a licensed healthcare provider.', nextQuestionId: Q3, ending: null },
      ],
    },
    {
      id: Q3,
      key: 'q3',
      position: 3,
      body: 'Ready to move forward? Reply 1. I know which antibiotic I need, 2. Talk to an agent for options & discounts, 3. Order online.',
      clarifyBody: 'Sorry, please reply 1. I know which antibiotic I need, 2. Talk to an agent, or 3. Order online.',
      heading: 'Next step',
      choices: [
        { choice: '1', label: 'I know which antibiotic', words: ['i know', 'know', 'i know which one'], points: 30, reply: `Great. Start your online consultation here: ${LINK}`, nextQuestionId: null, ending: 'completed' },
        { choice: '2', label: 'Talk to an agent', words: ['agent', 'talk', 'call', 'call me', 'talk to an agent'], points: 45, reply: 'Thanks! An eDrugstore representative will contact you to discuss available options, pricing and discounts.', nextQuestionId: null, ending: 'completed' },
        { choice: '3', label: 'Order online', words: ['online', 'order', 'order online'], points: 10, reply: `Great! Start your online order and consultation here: ${LINK}`, nextQuestionId: null, ending: 'completed' },
      ],
    },
    {
      id: OFFERS,
      key: 'offers',
      position: 4,
      body: 'Would you like to receive special offers from eDrugstore? Reply 1. Yes for offers, 2. Learn more from a rep, or STOP to unsubscribe.',
      clarifyBody: 'Sorry, please reply 1 for offers, 2 to learn more from a rep, or STOP to unsubscribe.',
      heading: 'Offers',
      choices: [
        { choice: '1', label: 'Special offers', words: ['yes', 'y', 'offers', 'offer'], points: 0, reply: "Thanks! You'll receive special offers from eDrugstore. Reply STOP to opt out.", nextQuestionId: null, ending: 'offers' },
        { choice: '2', label: 'Learn more', words: ['learn more', 'learn', 'more', 'learnmore'], points: 0, reply: 'Thanks! An eDrugstore representative will contact you shortly.', nextQuestionId: null, ending: 'wants_contact' },
      ],
    },
  ],
};

export const TIERS = [
  { name: 'HOT', minScore: 75, maxScore: 100 },
  { name: 'WARM', minScore: 45, maxScore: 74 },
  { name: 'LOW', minScore: 1, maxScore: 44 },
];

export const RULES: Rules = { flow: ANTIBIOTICS, tiers: TIERS, maxInvalidBeforeReview: 1 };
