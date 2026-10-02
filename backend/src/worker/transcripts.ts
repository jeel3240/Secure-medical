/**
 * Turns call recordings into transcripts - TWILIO.md, "Recordings and
 * transcripts". One step of the worker's loop.
 *
 * Each tick: asks Twilio to transcribe any recording not yet sent, and asks
 * after any transcript Twilio is still working on. Done here rather than in
 * the recording webhook so that webhook answers Twilio at once, and so a
 * Twilio hiccup is retried on the next tick instead of being lost.
 */

import { transcriptLines } from '../core/transcripts';
import { markAttemptFailed, markCompleted, markFailed, markQueued, openTranscripts } from '../db/transcripts';
import { readTranscript, requestTranscript } from '../integrations/twilio-transcripts';
import { errText, log } from '../lib/log';
import { readTwilioSettings } from '../twilio-settings';

export interface TranscriptStats {
  requested: number;
  completed: number;
  failed: number;
  waiting: number;
}

export async function advanceTranscripts(): Promise<TranscriptStats> {
  const stats: TranscriptStats = { requested: 0, completed: 0, failed: 0, waiting: 0 };
  const result = readTwilioSettings(process.env);
  // Nothing is recorded without a transcription service, so nothing waits here.
  if (result.status !== 'on' || !result.settings.transcriptionServiceSid) return stats;
  const settings = result.settings;

  for (const t of await openTranscripts()) {
    if (t.tooOld) {
      await markFailed(t.id, 'timed out');
      stats.failed += 1;
      continue;
    }

    if (t.status === 'pending') {
      try {
        await markQueued(t.id, await requestTranscript(settings, t.recordingSid, t.callId));
        stats.requested += 1;
      } catch (err) {
        const gaveUp = await markAttemptFailed(t.id, errText(err));
        log.warn('transcript.request_failed', { transcriptId: t.id, callId: t.callId, gaveUp, err: errText(err) });
        if (gaveUp) stats.failed += 1;
      }
      continue;
    }

    try {
      const state = await readTranscript(settings, t.transcriptSid!);
      if (state.state === 'completed') {
        await markCompleted(t.id, transcriptLines(t.direction, state.sentences));
        stats.completed += 1;
      } else if (state.state === 'failed') {
        await markFailed(t.id, state.reason);
        stats.failed += 1;
      } else {
        stats.waiting += 1;
      }
    } catch (err) {
      // Asked again next tick.
      log.warn('transcript.read_failed', { transcriptId: t.id, callId: t.callId, err: errText(err) });
      stats.waiting += 1;
    }
  }
  return stats;
}
