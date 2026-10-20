/**
 * A call's transcript, pure - TWILIO.md, "Recordings and transcripts".
 *
 * Twilio records a call in two channels: the call's first leg on channel 1,
 * the dialled leg on channel 2. Which of those is the agent depends on who
 * called whom, so the transcript's speakers are worked out here, once, when it
 * is stored.
 */

import type { CallDirection } from './calls';

export type Speaker = 'agent' | 'lead';

export interface TranscriptLine {
  speaker: Speaker;
  text: string;
  /** Seconds from the start of the recording. */
  startSec: number;
}

/**
 * - We called the lead: the agent's browser placed the call (channel 1) and
 *   dialled the lead (channel 2).
 * - The lead called us: their phone is the call (channel 1), and it dialled the
 *   agent's browser (channel 2).
 * - The server called the lead (automated, T4): the recording starts when an
 *   agent takes the transfer, and the call is the lead's leg (channel 1), which
 *   dialled the agent's browser (channel 2) - as when the lead calls us.
 *   Confirmed on a real transfer, 2026-10-20 (`AUTO-CALLS.md`, T15a).
 */
export function speakerFor(direction: CallDirection, channel: number): Speaker {
  const first: Speaker = direction === 'outbound' ? 'agent' : 'lead';
  const second: Speaker = direction === 'outbound' ? 'lead' : 'agent';
  return channel === 1 ? first : second;
}

/** Twilio's sentences, as it returns them. */
export interface RawSentence {
  mediaChannel: number;
  transcript: string;
  startTime: string;
}

/** In the order they were said, each with who said it. Empty sentences are dropped. */
export function transcriptLines(direction: CallDirection, sentences: RawSentence[]): TranscriptLine[] {
  return sentences
    .map((s) => ({
      speaker: speakerFor(direction, Number(s.mediaChannel)),
      text: (s.transcript ?? '').trim(),
      startSec: Math.round(Number(s.startTime) * 10) / 10 || 0,
    }))
    .filter((line) => line.text !== '')
    .sort((a, b) => a.startSec - b.startSec);
}

/** How many times the worker asks Twilio to start a transcript before giving up. */
export const MAX_TRANSCRIPT_ATTEMPTS = 5;

/** How long a transcript may take at Twilio before it is given up. Minutes, in practice. */
export const TRANSCRIPT_GIVE_UP_HOURS = 6;
