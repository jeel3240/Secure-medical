/**
 * Twilio, for browser calling - Phase 4, TWILIO.md.
 *
 * The only file that touches the twilio library. Everything here is a pure
 * function of the settings and its arguments: it makes no network call, so the
 * routes that use it are tested without Twilio.
 */

import twilio from 'twilio';
import type VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { identityFor, INCOMING_RING_SECONDS, MISSED_CALL_SPEECH } from '../core/calls';
import type { TwilioSettings } from '../twilio-settings';

/** An hour: long enough for a shift's calls, refreshed by the browser before it lapses. */
export const TOKEN_TTL_SECONDS = 60 * 60;

export const VOICE_PATH = '/api/webhooks/twilio/voice';
export const STATUS_PATH = '/api/webhooks/twilio/status';
/** A lead calling our number. The phone number's Voice URL points here. */
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
  const identity = identityFor(userId);
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
  client.identity(identityFor(agentId));
  client.parameter({ name: 'leadId', value: String(lead.id) });
  client.parameter({ name: 'leadName', value: lead.name });
  client.parameter({ name: 'leadPhone', value: lead.phone });
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
