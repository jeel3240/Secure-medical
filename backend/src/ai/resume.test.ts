/**
 * Picking a call back up after the line dropped - the conversation so far,
 * rebuilt from the turns kept on the call, as the call itself built it.
 */
import { FILLER_LINE, leadMessage, NO_REPEAT_NOTE, NOBODY_NOTE, STILL_THERE_LINE } from './conversation';
import { interruptedNote, keyTurn, reconnectedNote, refusedNote, replacedNote, stopNote, twilioErrorNote } from './relay-messages';
import { earlierConversation, type KeptTurn } from './resume';

const GREETING = 'Hi, is this John?';
const greeting: KeptTurn = { who: 'seri', text: GREETING };
const lead = (text: string): KeptTurn => ({ who: 'lead', text });
const seri = (text: string): KeptTurn => ({ who: 'seri', text });
const note = (text: string): KeptTurn => ({ who: 'system', text });
const said = (text: string) => ({ role: 'assistant', content: text });

describe('the conversation so far, from the kept turns', () => {
  it('her greeting is left out - the conversation already has it - and each turn follows, the lead\'s with who is there now', () => {
    const turns = [greeting, lead('Yes.'), seri('This is Seri from eDrugstore. Is that something you would be interested in?'), lead('What is it?'), seri('Up to 25% off your first order.')];
    expect(earlierConversation(turns, GREETING, 'coming')).toEqual({
      messages: [
        leadMessage('coming', 'Yes.'),
        said('This is Seri from eDrugstore. Is that something you would be interested in?'),
        leadMessage('coming', 'What is it?'),
        said('Up to 25% off your first order.'),
      ],
      pending: [],
    });
  });

  it('what the lead said after her last reply is not in it yet: it is for her to answer', () => {
    const turns = [greeting, lead('Yes.'), seri('This is Seri.'), lead('Hold on.'), lead('Okay, go ahead.')];
    expect(earlierConversation(turns, GREETING, 'free')).toEqual({
      messages: [leadMessage('free', 'Yes.'), said('This is Seri.')],
      pending: ['Hold on.', 'Okay, go ahead.'],
    });
  });

  it('two things the lead said before she answered are one turn, as on the call', () => {
    const turns = [greeting, lead('Yes.'), lead('Who is this?'), seri('This is Seri.')];
    expect(earlierConversation(turns, GREETING, 'free').messages[0]).toEqual(leadMessage('free', 'Yes. Who is this?'));
  });

  it('a key pressed and "One moment..." were never in the conversation, and are not now', () => {
    const turns = [greeting, lead('Yes.'), seri(FILLER_LINE), seri('This is Seri.'), lead(keyTurn('1'))];
    expect(earlierConversation(turns, GREETING, 'free')).toEqual({
      messages: [leadMessage('free', 'Yes.'), said('This is Seri.')],
      pending: [],
    });
  });

  it('"are you still there?" is hers, as on the call', () => {
    const turns = [greeting, lead('Yes.'), seri('This is Seri.'), seri(STILL_THERE_LINE), lead('Sorry, yes.')];
    expect(earlierConversation(turns, GREETING, 'free')).toEqual({
      messages: [leadMessage('free', 'Yes.'), said('This is Seri.'), said(STILL_THERE_LINE)],
      pending: ['Sorry, yes.'],
    });
  });

  it('talked over: only what the lead heard of her reply - or nothing, when they heard none of it', () => {
    const cut = [greeting, lead('Yes.'), seri('This is Seri from eDrugstore. We have an offer.'), note(interruptedNote('This is Seri')), lead('Who?')];
    expect(earlierConversation(cut, GREETING, 'free').messages).toEqual([leadMessage('free', 'Yes.'), said('This is Seri')]);
    const unheard = [greeting, lead('Yes.'), seri('This is Seri.'), note(interruptedNote('')), lead('Who?')];
    expect(earlierConversation(unheard, GREETING, 'free')).toEqual({ messages: [leadMessage('free', 'Yes.')], pending: ['Who?'] });
  });

  it('an action refused is told to her again, as its note', () => {
    const refused = refusedNote('transfer_to_agent', 'Nobody can take the call now. Offer a call back instead.');
    const turns = [greeting, lead('Put me through.'), seri('Sure.'), note(refused)];
    expect(earlierConversation(turns, GREETING, 'nobody').messages).toEqual([
      leadMessage('nobody', 'Put me through.'),
      { role: 'system', content: NOBODY_NOTE },
      said('Sure.'),
      { role: 'system', content: refused },
    ]);
  });

  it('the other notes are for the record only', () => {
    const turns = [
      greeting,
      lead('Yes.'),
      seri('That is a great question for a licensed provider.'),
      note(replacedNote('advice', 'dose', 'Take two a day.')),
      note(twilioErrorNote('Something broke')),
      note(reconnectedNote(1)),
      note(stopNote('words')),
    ];
    expect(earlierConversation(turns, GREETING, 'free').messages).toEqual([
      leadMessage('free', 'Yes.'),
      said('That is a great question for a licensed provider.'),
    ]);
  });

  it('after a reply that offered to connect them, the note against offering again - as on the call', () => {
    const turns = [greeting, lead('Yes.'), seri('Would you like me to connect you with someone now?'), lead('What do you sell?'), seri('Antibiotics.')];
    expect(earlierConversation(turns, GREETING, 'free').messages).toEqual([
      leadMessage('free', 'Yes.'),
      said('Would you like me to connect you with someone now?'),
      leadMessage('free', 'What do you sell?'),
      { role: 'system', content: NO_REPEAT_NOTE },
      said('Antibiotics.'),
    ]);
  });

  it('only the greeting so far, or nothing kept at all: an empty conversation', () => {
    expect(earlierConversation([greeting], GREETING, 'free')).toEqual({ messages: [], pending: [] });
    expect(earlierConversation([], GREETING, 'free')).toEqual({ messages: [], pending: [] });
    expect(earlierConversation([lead('Yes?')], GREETING, 'free')).toEqual({ messages: [], pending: ['Yes?'] });
  });
});
