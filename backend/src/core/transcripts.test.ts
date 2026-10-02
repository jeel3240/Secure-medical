import { speakerFor, transcriptLines } from './transcripts';

describe('who said it', () => {
  it('a call we placed: the agent is channel 1, the lead channel 2', () => {
    expect(speakerFor('outbound', 1)).toBe('agent');
    expect(speakerFor('outbound', 2)).toBe('lead');
  });

  it('a call the lead placed: the other way round', () => {
    expect(speakerFor('inbound', 1)).toBe('lead');
    expect(speakerFor('inbound', 2)).toBe('agent');
  });
});

describe('the transcript, from Twilio\'s sentences', () => {
  it('in the order said, each with its speaker and time', () => {
    const lines = transcriptLines('outbound', [
      { mediaChannel: 2, transcript: 'Yes, I filled in the form.', startTime: '3.46' },
      { mediaChannel: 1, transcript: 'Hi Priya, it is Maya from Secure Medical.', startTime: '0.8' },
    ]);
    expect(lines).toEqual([
      { speaker: 'agent', text: 'Hi Priya, it is Maya from Secure Medical.', startSec: 0.8 },
      { speaker: 'lead', text: 'Yes, I filled in the form.', startSec: 3.5 },
    ]);
  });

  it('drops empty sentences and survives a missing time', () => {
    const lines = transcriptLines('inbound', [
      { mediaChannel: 1, transcript: '  ', startTime: '1' },
      { mediaChannel: 1, transcript: 'Hello?', startTime: '' },
    ]);
    expect(lines).toEqual([{ speaker: 'lead', text: 'Hello?', startSec: 0 }]);
  });
});
