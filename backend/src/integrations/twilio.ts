/**
 * Twilio, for browser calling - Phase 4, TWILIO.md - and for the automated
 * call's words (T12, AUTO-CALLS.md).
 *
 * Everything here is a pure function of the settings and its arguments: it
 * makes no network call, so the routes that use it are tested without Twilio.
 * Asking Twilio to place a call is `integrations/twilio-calls.ts`.
 */

import twilio from 'twilio';
import type VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { splitForListening, type AskOrEnd, type CallScript, type CallStep } from '../core/call-script';
import { identityFor, INCOMING_RING_SECONDS, MISSED_CALL_SPEECH, RECORDING_NOTICE } from '../core/calls';
import type { TwilioSettings } from '../twilio-settings';

/** An hour: long enough for a shift's calls, refreshed by the browser before it lapses. */
export const TOKEN_TTL_SECONDS = 60 * 60;

export const VOICE_PATH = '/api/webhooks/twilio/voice';
export const STATUS_PATH = '/api/webhooks/twilio/status';
/** A lead calling our number. The phone number's Voice URL points here. */
/** What the lead hears before a recorded call we placed is connected - the recording notice. */
export const NOTICE_PATH = '/api/webhooks/twilio/notice';

/** A call's recording is ready - TWILIO.md, "Recordings and transcripts". */
export const RECORDING_PATH = '/api/webhooks/twilio/recording';

/**
 * Recording, for a `<Dial>` - only when a transcription service is set, since
 * a recording is kept for its transcript.
 *
 * `record-from-answer-dual`: from the moment it is answered, in two channels,
 * the call's first leg on channel 1 and the dialled leg on channel 2 - the
 * agent and the lead apart, so the transcript can say who said what. The
 * call's own id rides in the callback address, as for answering machine
 * detection: our row is keyed by the first leg.
 */
function recordingAttributes(settings: TwilioSettings, callSid: string): Partial<VoiceResponse.DialAttributes> {
  if (!settings.transcriptionServiceSid) return {};
  return {
    record: 'record-from-answer-dual',
    recordingStatusCallback: `${settings.publicUrl}${RECORDING_PATH}?call=${encodeURIComponent(callSid)}`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: ['completed'],
  };
}

/** Twilio's verdict on who picked up a call we placed: a person or a machine. */
export const AMD_PATH = '/api/webhooks/twilio/answered-by';
export const INCOMING_PATH = '/api/webhooks/twilio/incoming';
/** Where Twilio goes once ringing the agent is over, to ask what to say to the lead. */
export const INCOMING_AFTER_PATH = '/api/webhooks/twilio/incoming/after';

/**
 * The browser's permission to place calls through our TwiML App, as one agent,
 * and to be rung as that agent when one of their leads calls back.
 */
export function mintCallToken(settings: TwilioSettings, userId: number): { token: string; identity: string } {
  const identity = identityFor(userId, settings.identityPrefix);
  const token = new twilio.jwt.AccessToken(settings.accountSid, settings.apiKey, settings.apiSecret, {
    identity,
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant(
    new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: settings.twimlAppSid,
      incomingAllow: true,
    })
  );
  return { token: token.toJwt(), identity };
}

/**
 * Whether a webhook request really came from Twilio: its X-Twilio-Signature is
 * an HMAC of the exact URL Twilio requested plus the posted fields, keyed with
 * our auth token. The URL is rebuilt from PUBLIC_URL, not from the request,
 * because a proxy in front of the API changes the scheme and may change the
 * host Express sees.
 */
export function isFromTwilio(
  settings: TwilioSettings,
  opts: { signature: string | undefined; path: string; params: Record<string, unknown> }
): boolean {
  if (!opts.signature) return false;
  return twilio.validateRequest(settings.authToken, opts.signature, settings.publicUrl + opts.path, opts.params);
}

/**
 * Connect the agent's browser to the lead's phone, showing our number.
 *
 * `answerOnBridge` keeps the browser's side ringing until the lead answers, so
 * the agent hears real ringback and the screen's "Ringing" is true, rather than
 * the browser leg showing connected while the phone is still ringing.
 * The status callback on the lead's leg reports how the call ended, however it
 * ends - either side hanging up, no answer, busy, a bad number.
 *
 * `machineDetection` has Twilio listen to the first seconds after the phone
 * picks up and tell us, at `amdStatusCallback`, whether a person or a
 * voicemail answered (TWILIO.md, "Voicemail"). The agent is connected at once
 * either way: detection runs beside the call, not in front of it. The call's
 * own id rides in that URL because the report is made on the lead's leg, and
 * our row is keyed by the browser's.
 */
export function dialTwiml(settings: TwilioSettings, phone: string, callSid: string): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    callerId: settings.callerId,
    answerOnBridge: true,
    ...recordingAttributes(settings, callSid),
  });
  dial.number(
    {
      statusCallback: settings.publicUrl + STATUS_PATH,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['completed'],
      machineDetection: 'Enable',
      amdStatusCallback: `${settings.publicUrl}${AMD_PATH}?call=${encodeURIComponent(callSid)}`,
      amdStatusCallbackMethod: 'POST',
      // On a recorded call the lead is told so before the agent is connected:
      // Twilio runs this on the lead's side once they pick up. TWILIO.md.
      ...(settings.transcriptionServiceSid ? { url: settings.publicUrl + NOTICE_PATH, method: 'POST' } : {}),
    },
    phone
  );
  return response.toString();
}

/**
 * Ring one agent's browser for a lead who is calling us.
 *
 * The lead's id, name and number ride along as parameters, so the browser can
 * say who is calling without a round trip. The status callback on the agent's
 * leg reports how it ended - answered, not answered, declined, or the lead
 * hanging up first - and `action` is where Twilio asks what to say to the lead
 * if the agent did not pick up.
 */
export function ringAgentTwiml(
  settings: TwilioSettings,
  agentId: number,
  lead: { id: number; name: string; phone: string },
  /** The lead's call - our row for it, and what its recording is reported against. */
  callSid: string
): string {
  const response = new twilio.twiml.VoiceResponse();
  // A recorded call: the lead hears the notice first, then the agent rings.
  if (settings.transcriptionServiceSid) response.say(RECORDING_NOTICE);
  const dial = response.dial({
    timeout: INCOMING_RING_SECONDS,
    answerOnBridge: true,
    action: settings.publicUrl + INCOMING_AFTER_PATH,
    method: 'POST',
    ...recordingAttributes(settings, callSid),
  });
  const client = dial.client({
    statusCallback: settings.publicUrl + STATUS_PATH,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['completed'],
  });
  client.identity(identityFor(agentId, settings.identityPrefix));
  client.parameter({ name: 'leadId', value: String(lead.id) });
  client.parameter({ name: 'leadName', value: lead.name });
  client.parameter({ name: 'leadPhone', value: lead.phone });
  return response.toString();
}

/** The recording notice by itself: what Twilio plays to a lead we called, before connecting them. */
export function recordingNoticeTwiml(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(RECORDING_NOTICE);
  return response.toString();
}

/** Nobody answered: tell the lead we will call back, then end the call. */
export function missedCallTwiml(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(MISSED_CALL_SPEECH);
  response.hangup();
  return response.toString();
}

/** Nothing more to say - the call was answered and is over. */
export function emptyTwiml(): string {
  return new twilio.twiml.VoiceResponse().toString();
}

/** Tell the agent why, then end the call. */
export function refusalTwiml(speech: string): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(speech);
  response.hangup();
  return response.toString();
}

/** End the call, saying nothing - for a request we cannot act on. */
export function hangupTwiml(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.hangup();
  return response.toString();
}

/**
 * The automated call's webhooks - T12, AUTO-CALLS.md. Each address names the
 * call's row (`?call=<id>`): the row exists before Twilio is asked, while
 * Twilio's own id for the call may not have reached us yet.
 */
export const AUTO_ANSWER_PATH = '/api/webhooks/twilio/auto/answer';
/** The lead answered a question - or said nothing. */
export const AUTO_GATHER_PATH = '/api/webhooks/twilio/auto/gather';
export const AUTO_STATUS_PATH = '/api/webhooks/twilio/auto/status';
/** Twilio's verdict on who picked up: a person or a machine. */
export const AUTO_AMD_PATH = '/api/webhooks/twilio/auto/amd';

/** The full address of one of those webhooks, for one call. */
export function autoCallUrl(
  settings: TwilioSettings,
  path: string,
  callId: number,
  extra: Record<string, string | number> = {}
): string {
  const query = new URLSearchParams({ call: String(callId) });
  for (const [key, value] of Object.entries(extra)) query.set(key, String(value));
  return `${settings.publicUrl}${path}?${query.toString()}`;
}

/**
 * How Twilio hears an answer - T13b, measured on recorded real calls
 * (2026-10-19): from the end of a spoken answer to Twilio reporting it.
 *
 * - Twilio's own model, `speechTimeout` auto: 3.3-3.4 s.
 * - Its own model, `speechTimeout` 1: 2.1 s, but 5.4 s when a noise on the
 *   line restarted the wait.
 * - **Deepgram's `nova-3`, `speechTimeout` 1: 1.6-1.7 s** on "yes", "no",
 *   "no thanks" and "stop calling me", and surer of them (0.53-0.999).
 * - Twilio's short-answer model, tried in T13: no faster, a clear "yes" 0.24.
 *
 * A provider's own model is not failed over by Twilio in an outage; a spoken
 * answer would then come back empty, and the call asks again for keys, which
 * need no speech service. Naming a model needs `speechTimeout` in whole
 * seconds (Twilio: "Don't use auto"): it stops after one second of quiet.
 */
const SPEECH_MODEL = 'deepgram_nova-3';
const SPEECH_TIMEOUT_SECONDS = '1';

/** The words a step's answer may hold - Twilio listens harder for them. */
function hintsFor(script: CallScript, step: CallStep): string {
  const words = [...step.choices.flatMap((choice) => choice.words), ...script.optOutWords];
  return [...new Set(words)].join(', ');
}

/**
 * What the automated call says and does next, in Twilio's words - T12.
 * `core/call-script.ts` decides it; this only writes it down.
 *
 * - **ask**: the lead-in said first, with nothing listening - a "Hello?" over
 *   the greeting is not the answer - then the question itself inside a
 *   `<Gather>` that listens for speech and one key from its first word
 *   (`splitForListening`; `bargeIn` on, so an answer over the end of the
 *   question is heard - T13, after answers were lost on the first real calls).
 *   `actionOnEmptyResult`: silence is reported too, so the server decides what
 *   silence means - ask again, or end. The answer goes to `/auto/gather`, with
 *   the step and which asking it was.
 * - **end**: the lines, then hang up.
 *
 * `pauseFirst`, when the lead has just picked up: a second of quiet first, so
 * the first words are not lost to a phone still coming to the ear.
 */
export function autoCallTwiml(
  settings: TwilioSettings,
  opts: { callId: number; script: CallScript; action: AskOrEnd; pauseFirst?: boolean }
): string {
  const { script, action } = opts;
  // The script's voice is a row; Twilio's list of names is the type.
  const voice = { voice: script.voice as VoiceResponse.SayAttributes['voice'] };
  const response = new twilio.twiml.VoiceResponse();
  if (opts.pauseFirst) response.pause({ length: 1 });

  if (action.kind === 'end') {
    for (const line of action.say) response.say(voice, line);
    response.hangup();
    return response.toString();
  }

  const { leadIn, question } = splitForListening(action.say);
  for (const line of leadIn) response.say(voice, line);
  const gather = response.gather({
    input: ['speech', 'dtmf'],
    numDigits: 1,
    speechModel: SPEECH_MODEL,
    speechTimeout: SPEECH_TIMEOUT_SECONDS,
    bargeIn: true,
    actionOnEmptyResult: true,
    hints: hintsFor(script, action.step),
    action: autoCallUrl(settings, AUTO_GATHER_PATH, opts.callId, { step: action.step.id, try: action.attempt }),
    method: 'POST',
  });
  if (question) gather.say(voice, question);
  return response.toString();
}
