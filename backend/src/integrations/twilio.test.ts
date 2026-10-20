import twilio from 'twilio';
import type { TwilioSettings } from '../twilio-settings';
import { ANTIBIOTICS_CALL as SCRIPT } from '../core/call-script-fixtures';
import {
  autoCallTwiml,
  autoCallUrl,
  transferTwiml,
  AUTO_ANSWER_PATH,
  dialTwiml,
  emptyTwiml,
  hangupTwiml,
  isFromTwilio,
  mintCallToken,
  missedCallTwiml,
  refusalTwiml,
  recordingNoticeTwiml,
  ringAgentTwiml,
  TOKEN_TTL_SECONDS,
} from './twilio';

const SETTINGS: TwilioSettings = {
  accountSid: `AC${'1'.repeat(32)}`,
  authToken: 'f'.repeat(32),
  apiKey: `SK${'2'.repeat(32)}`,
  apiSecret: 'S'.repeat(32),
  twimlAppSid: `AP${'3'.repeat(32)}`,
  callerId: '+14804708259',
  publicUrl: 'https://calls.example.com',
  identityPrefix: '',
};

const payload = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

describe('the browser call token', () => {
  it('carries this server\'s identity prefix, so a laptop is never named like production', () => {
    const { token, identity } = mintCallToken({ ...SETTINGS, identityPrefix: 'dev-' }, 21);
    expect(identity).toBe('dev-agent-21');
    expect(payload(token).grants.identity).toBe('dev-agent-21');
  });

  it('lets one agent place calls through our TwiML App, and be rung as that agent', () => {
    const { token, identity } = mintCallToken(SETTINGS, 21);
    const claims = payload(token);
    expect(identity).toBe('agent-21');
    expect(claims.iss).toBe(SETTINGS.apiKey);
    expect(claims.sub).toBe(SETTINGS.accountSid);
    expect(claims.grants.identity).toBe('agent-21');
    expect(claims.grants.voice.outgoing.application_sid).toBe(SETTINGS.twimlAppSid);
    // Incoming: so a lead calling back can ring this agent's browser.
    expect(claims.grants.voice.incoming.allow).toBe(true);
    expect(claims.exp - claims.iat).toBe(TOKEN_TTL_SECONDS);
  });
});

describe('telling Twilio how to connect', () => {
  it('dials the lead from our number, rings until answered, and reports how it ended', () => {
    const xml = dialTwiml(SETTINGS, '+16026203572', 'CA100');
    expect(xml).toContain('callerId="+14804708259"');
    expect(xml).toContain('answerOnBridge="true"');
    expect(xml).toContain('statusCallback="https://calls.example.com/api/webhooks/twilio/status"');
    expect(xml).toMatch(/<Number[^>]*>\+16026203572<\/Number>/);
  });

  it('asks Twilio whether a person or a machine picks up, and to say which call it was', () => {
    const xml = dialTwiml(SETTINGS, '+16026203572', 'CA100');
    expect(xml).toContain('machineDetection="Enable"');
    expect(xml).toContain('amdStatusCallback="https://calls.example.com/api/webhooks/twilio/answered-by?call=CA100"');
    expect(xml).toContain('amdStatusCallbackMethod="POST"');
  });

  it('does not record without a transcription service', () => {
    expect(dialTwiml(SETTINGS, '+16026203572', 'CA100')).not.toContain('record=');
  });

  it('with one, records the call in two channels and says which call the recording is for', () => {
    const xml = dialTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, '+16026203572', 'CA100');
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain('recordingStatusCallback="https://calls.example.com/api/webhooks/twilio/recording?call=CA100"');
    expect(xml).toContain('recordingStatusCallbackEvent="completed"');
  });

  it('a recorded call we place tells the lead so before connecting them; an unrecorded one says nothing', () => {
    const recorded = dialTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, '+16026203572', 'CA100');
    expect(recorded).toContain('url="https://calls.example.com/api/webhooks/twilio/notice"');
    expect(dialTwiml(SETTINGS, '+16026203572', 'CA100')).not.toContain('/notice');
    expect(recordingNoticeTwiml()).toContain('<Say>This call may be recorded and transcribed for quality, training, and service purposes. By continuing, you consent to the recording and transcription.</Say>');
  });

  it('a refusal says why, then hangs up', () => {
    expect(refusalTwiml('Pick up this lead first.')).toMatch(/<Say>Pick up this lead first\.<\/Say><Hangup\/>/);
  });
});

describe('a lead calling our number', () => {
  it('rings the browser by this server\'s name for the agent - never another copy\'s', () => {
    const lead = { id: 7, name: 'Priya Sharma', phone: '+16026203572' };
    expect(ringAgentTwiml({ ...SETTINGS, identityPrefix: 'dev-' }, 21, lead, 'CA300')).toContain(
      '<Identity>dev-agent-21</Identity>'
    );
  });

  it('rings one agent’s browser for 20 seconds, saying who is calling', () => {
    const xml = ringAgentTwiml(SETTINGS, 21, { id: 7, name: 'Priya Sharma', phone: '+16026203572' }, 'CA300');
    expect(xml).toContain('timeout="20"');
    expect(xml).toContain('<Identity>agent-21</Identity>');
    expect(xml).toContain('<Parameter name="leadId" value="7"/>');
    expect(xml).toContain('<Parameter name="leadName" value="Priya Sharma"/>');
    expect(xml).toContain('<Parameter name="leadPhone" value="+16026203572"/>');
    // Reported when it ends, and asked what to say if nobody picked up.
    expect(xml).toContain('statusCallback="https://calls.example.com/api/webhooks/twilio/status"');
    expect(xml).toContain('action="https://calls.example.com/api/webhooks/twilio/incoming/after"');
  });

  it('records an incoming call too, when there is a transcription service', () => {
    const lead = { id: 7, name: 'Priya Sharma', phone: '+16026203572' };
    const xml = ringAgentTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, 21, lead, 'CA300');
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain('/api/webhooks/twilio/recording?call=CA300');
    expect(ringAgentTwiml(SETTINGS, 21, lead, 'CA300')).not.toContain('record=');
  });

  it('a recorded incoming call: the lead hears the notice first, then the agent rings', () => {
    const lead = { id: 7, name: 'Priya Sharma', phone: '+16026203572' };
    const xml = ringAgentTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, 21, lead, 'CA300');
    expect(xml.indexOf('<Say>This call may be recorded')).toBeGreaterThan(-1);
    expect(xml.indexOf('<Say>This call may be recorded')).toBeLessThan(xml.indexOf('<Dial'));
    expect(ringAgentTwiml(SETTINGS, 21, lead, 'CA300')).not.toContain('<Say>');
  });

  it('unanswered, tells the lead we will call back and hangs up', () => {
    expect(missedCallTwiml()).toMatch(/<Say>.*will call you back.*<\/Say><Hangup\/>/);
  });

  it('answered and over, has nothing more to say', () => {
    expect(emptyTwiml()).toMatch(/<Response\s*\/>/);
  });
});

describe('checking a request came from Twilio', () => {
  const params = { CallSid: 'CA1', From: 'client:agent-21' };
  const path = '/api/webhooks/twilio/voice';
  const signature = twilio.getExpectedTwilioSignature(SETTINGS.authToken, SETTINGS.publicUrl + path, params);

  it('accepts Twilio’s signature over our public URL', () => {
    expect(isFromTwilio(SETTINGS, { signature, path, params })).toBe(true);
  });

  it('refuses no signature, a changed field, or another URL', () => {
    expect(isFromTwilio(SETTINGS, { signature: undefined, path, params })).toBe(false);
    expect(isFromTwilio(SETTINGS, { signature, path, params: { ...params, From: 'client:agent-1' } })).toBe(false);
    expect(isFromTwilio(SETTINGS, { signature, path: '/api/webhooks/twilio/status', params })).toBe(false);
  });
});

describe('the automated call, in Twilio\'s words (T12)', () => {
  const [OFFER] = SCRIPT.steps;
  const ask = { kind: 'ask' as const, step: OFFER, attempt: 1 as const, say: [OFFER.body] };

  it('names the call\'s row in every webhook address, with anything else it needs', () => {
    expect(autoCallUrl(SETTINGS, AUTO_ANSWER_PATH, 42)).toBe('https://calls.example.com/api/webhooks/twilio/auto/answer?call=42');
    expect(autoCallUrl(SETTINGS, '/x', 42, { step: 3, try: 2 })).toBe('https://calls.example.com/x?call=42&step=3&try=2');
  });

  it('asks: a second of quiet, the lead-in with nothing listening, then the question itself, listening from its first word', () => {
    const xml = autoCallTwiml(SETTINGS, { callId: 42, script: SCRIPT, action: ask, pauseFirst: true });
    // "Hello?" over the greeting is not the answer: nothing listens yet.
    expect(xml).toMatch(
      /^<\?xml[^>]*><Response><Pause length="1"\/><Say voice="Google\.en-US-Chirp3-HD-Kore">Hi, this is Seri calling from eDrugstore\. Today we're offering 25% off antibiotics\.<\/Say><Gather /
    );
    expect(xml).toContain('input="speech dtmf"');
    expect(xml).toContain('numDigits="1"');
    // Deepgram, ending after one second of quiet: half the wait of Twilio's own, measured (T13b).
    expect(xml).toContain('speechModel="deepgram_nova-3"');
    expect(xml).toContain('speechTimeout="1"');
    // An answer over the end of the question is heard; silence is reported, not skipped.
    expect(xml).toContain('bargeIn="true"');
    expect(xml).toContain('actionOnEmptyResult="true"');
    expect(xml).toContain(
      `action="https://calls.example.com/api/webhooks/twilio/auto/gather?call=42&amp;step=${OFFER.id}&amp;try=1"`
    );
    expect(xml).toMatch(/<Say voice="Google\.en-US-Chirp3-HD-Kore">Are you interested in ordering\?<\/Say><\/Gather><\/Response>$/);
  });

  it('listens hardest for the step\'s own words and the stop words', () => {
    const xml = autoCallTwiml(SETTINGS, { callId: 42, script: SCRIPT, action: ask });
    const hints = /hints="([^"]*)"/.exec(xml)![1].split(', ');
    expect(hints).toEqual(expect.arrayContaining(['yes', 'not interested', 'stop calling', 'remove me']));
    expect(new Set(hints).size).toBe(hints.length);
  });

  it('a later asking has no pause, and never a recording notice - nothing is recorded before a transfer', () => {
    const xml = autoCallTwiml({ ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` }, { callId: 42, script: SCRIPT, action: ask });
    expect(xml).not.toContain('<Pause');
    expect(xml).not.toContain('recorded');
  });

  it('ends: says the lines, then hangs up - no listening', () => {
    const xml = autoCallTwiml(SETTINGS, {
      callId: 42,
      script: SCRIPT,
      action: { kind: 'end', say: [SCRIPT.noResponseBody], result: 'no_response' },
    });
    expect(xml).toContain('<Say voice="Google.en-US-Chirp3-HD-Kore">Thank you for your time. Have a great day.</Say><Hangup/>');
    expect(xml).not.toContain('<Gather');
  });

  it('ends a call it cannot act on without a word', () => {
    expect(hangupTwiml()).toMatch(/<Response><Hangup\/><\/Response>$/);
  });
});

describe('the transfer, in Twilio\'s words (T15a, T15b)', () => {
  const base = {
    callId: 42,
    callSid: 'CA900',
    script: SCRIPT,
    say: ['Great, connecting you with a live agent now. Please hold.'],
    notice: true,
    agentIds: [16, 21],
    holderFirst: false,
    lead: { id: 7, name: 'Priya Sharma', phone: '+15550100016' },
    step: { id: 10, heading: 'Offer' },
    ringSeconds: 25,
  };

  it('the line, then every free person rung together, for the ring time, the end going to /auto/after', () => {
    const xml = transferTwiml({ ...SETTINGS, identityPrefix: 'dev-' }, base);
    expect(xml).toContain('<Say voice="Google.en-US-Chirp3-HD-Kore">Great, connecting you with a live agent now. Please hold.</Say><Dial');
    expect(xml).toContain('timeout="25"');
    expect(xml).toContain('action="https://calls.example.com/api/webhooks/twilio/auto/after?call=42&amp;step=10"');
    expect(xml.match(/<Client /g)).toHaveLength(2);
    expect(xml).toContain('<Identity>dev-agent-16</Identity>');
    expect(xml).toContain('<Identity>dev-agent-21</Identity>');
  });

  it('accepting runs /auto/claim on the person\'s leg; no per-person end reports', () => {
    const xml = transferTwiml(SETTINGS, base);
    expect(xml).toContain('<Client url="https://calls.example.com/api/webhooks/twilio/auto/claim?call=42" method="POST">');
    expect(xml).not.toContain('statusCallback');
  });

  it('each ring says who is calling, and that it is a transfer of a yes to the offer (T11)', () => {
    const xml = transferTwiml(SETTINGS, base);
    for (const [name, value] of [
      ['leadId', '7'],
      ['leadName', 'Priya Sharma'],
      ['leadPhone', '+15550100016'],
      ['ring', 'group'],
      ['reason', 'transfer'],
      ['step', 'Offer'],
    ]) {
      expect(xml.split(`<Parameter name="${name}" value="${value}"/>`)).toHaveLength(3);
    }
  });

  it('on a recorded call: the notice before the ringing, and the recording from the answer, both sides apart', () => {
    const recorded = { ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` };
    const xml = transferTwiml(recorded, base);
    expect(xml).toContain('This call may be recorded and transcribed');
    expect(xml.indexOf('may be recorded')).toBeLessThan(xml.indexOf('<Dial'));
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain('recordingStatusCallback="https://calls.example.com/api/webhooks/twilio/recording?call=CA900"');
    expect(transferTwiml(SETTINGS, base)).not.toContain('record=');
  });

  it('the lead\'s own agent alone first: /auto/after is told who, so the others are rung next (T15b)', () => {
    const xml = transferTwiml(SETTINGS, { ...base, agentIds: [21], holderFirst: true });
    expect(xml.match(/<Client /g)).toHaveLength(1);
    expect(xml).toContain('<Identity>agent-21</Identity>');
    expect(xml).toContain('action="https://calls.example.com/api/webhooks/twilio/auto/after?call=42&amp;step=10&amp;holder=21"');
    // Shared all the same: it goes on without them - cleared quietly, declined while busy (T11).
    expect(xml).toContain('<Parameter name="ring" value="group"/>');
  });

  it('the ring after them: nothing said, and no notice again - the lead has heard it', () => {
    const recorded = { ...SETTINGS, transcriptionServiceSid: `GA${'4'.repeat(32)}` };
    const xml = transferTwiml(recorded, { ...base, say: [], notice: false });
    expect(xml).not.toContain('<Say');
    expect(xml).toMatch(/<Response><Dial /);
    expect(xml).toContain('record="record-from-answer-dual"');
  });
});
