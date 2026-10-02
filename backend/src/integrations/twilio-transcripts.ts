/**
 * Twilio's transcription service - TWILIO.md, "Recordings and transcripts".
 *
 * The only file that talks to it. The worker asks it to transcribe a
 * recording, then asks again until the transcript is ready.
 */

import twilio from 'twilio';
import type { RawSentence } from '../core/transcripts';
import type { TwilioSettings } from '../twilio-settings';

function client(settings: TwilioSettings) {
  return twilio(settings.accountSid, settings.authToken);
}

/**
 * Asks for a recording to be transcribed. Returns Twilio's id for the
 * transcript. The participants are named by channel so Twilio's own console
 * reads sensibly; our speakers are worked out from the channel, not these.
 */
export async function requestTranscript(settings: TwilioSettings, recordingSid: string, callId: number): Promise<string> {
  const transcript = await client(settings).intelligence.v2.transcripts.create({
    serviceSid: settings.transcriptionServiceSid!,
    channel: { media_properties: { source_sid: recordingSid } },
    // Ours, so a transcript in Twilio's console can be found from the call.
    customerKey: `call-${callId}`,
  });
  return transcript.sid;
}

export type TranscriptState =
  | { state: 'waiting' }
  | { state: 'completed'; sentences: RawSentence[] }
  | { state: 'failed'; reason: string };

/** Where a transcript is at Twilio, with its sentences once it is done. */
export async function readTranscript(settings: TwilioSettings, transcriptSid: string): Promise<TranscriptState> {
  const transcript = client(settings).intelligence.v2.transcripts(transcriptSid);
  const { status } = await transcript.fetch();
  if (status === 'completed') {
    const sentences = await transcript.sentences.list({ pageSize: 1000 });
    return {
      state: 'completed',
      sentences: sentences.map((s) => ({ mediaChannel: s.mediaChannel, transcript: s.transcript, startTime: String(s.startTime) })),
    };
  }
  if (status === 'failed' || status === 'error' || status === 'canceled') return { state: 'failed', reason: status };
  return { state: 'waiting' };
}
