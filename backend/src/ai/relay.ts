/**
 * The relay: Seri's side of a ConversationRelay call - A10, A11 and A12,
 * docs/AI-AGENT.md sections 1, 6 and 9.
 *
 * Twilio opens a WebSocket to `/api/ai/relay` when an automated call is
 * connected to Seri (A13), sends what the lead says as text, and speaks what
 * we send back. This part is the pipe: who may connect, which call it is, and
 * every turn kept. What she says is the conversation's (conversation.ts).
 *
 *   connection  refused unless signed by Twilio for the relay's own address
 *   setup       names our `calls` row; Seri starts it once (relay-store.ts),
 *               with her instructions built for the call, and her greeting -
 *               which Twilio says itself - is her first turn
 *   prompt      the lead's words, kept, then hers to answer
 *   dtmf        the key, kept as the lead's turn; 9 is a stop
 *   interrupt   what she had said when the lead spoke over her, as a note
 *   info        who is talking - `agentSpeaking`, `clientSpeaking` - for the
 *               silence count (A12); not kept
 *
 * When Seri cannot go on - OpenAI failing or too slow, the socket or the relay
 * failing - the session ends with `fallback` and the script takes the call
 * (A12, A14). A session that closes with no end of ours - the lead hung up, or
 * Twilio's side failed - is the action URL's to record (A14, A18).
 *
 * Messages are handled one at a time, in the order they came. Turns are kept
 * on their own line of writes, in the order they were said, and nothing on the
 * call waits for them: a turn that cannot be saved is logged and the call goes
 * on - the lead is talking to her.
 */

import type { Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { errText, log } from '../lib/log';
import { Conversation, type Timers } from './conversation';
import { buildInstructions, welcomeGreeting } from './instructions';
import type { Knowledge } from './knowledge';
import type { SeriModel } from './openai';
import {
  interruptedNote,
  keyTurn,
  parseRelayMessage,
  RELAY_PATH,
  relaySigned,
  twilioErrorNote,
  type RelayMessage,
} from './relay-messages';
import type { AiCall, RelayStore, Turn } from './relay-store';

export interface RelayDeps {
  /**
   * From calling's settings: the token signatures are checked with, our
   * public address, and the number she gives when asked how to call back.
   */
  twilio: { authToken: string; publicUrl: string; callerId: string };
  /** Seri's knowledge files, checked at start-up; their version is kept on each call she takes. */
  knowledge: Knowledge;
  store: RelayStore;
  model: SeriModel;
  /** How long Twilio has, once connected, to send `setup`. */
  setupTimeoutMs?: number;
  now?: () => Date;
  /** Where the call's limits are counted (A12) - a fake clock in tests. */
  timers?: Timers;
}

const SETUP_TIMEOUT_MS = 10_000;

/** WebSocket close codes: refused (policy), and failed on our side. */
const REFUSED = 1008;
const FAILED = 1011;

/**
 * Listens for the relay's WebSocket on the API's own server. Every other
 * WebSocket request is refused: the app has no other.
 */
export function attachRelay(server: Server, deps: RelayDeps): WebSocketServer {
  // A turn is a sentence or two; nothing Twilio sends comes near this.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const path = url.split('?')[0];
    if (path !== RELAY_PATH) {
      log.warn('ai_relay.refused', { reason: 'not_found', path });
      refuseUpgrade(socket, 404);
      return;
    }
    const header = req.headers['x-twilio-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!relaySigned(deps.twilio.authToken, deps.twilio.publicUrl, { signature, url })) {
      // As for a webhook: a wrong PUBLIC_URL is the likeliest cause.
      log.warn('ai_relay.refused', { reason: 'bad_signature' });
      refuseUpgrade(socket, 403);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => runSession(ws, deps));
  });

  return wss;
}

/** No WebSocket at all: a plain HTTP answer, then the connection closed. */
function refuseUpgrade(socket: Duplex, status: 403 | 404): void {
  const text = status === 403 ? 'Forbidden' : 'Not Found';
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function runSession(ws: WebSocket, deps: RelayDeps): void {
  /** Set once `setup` has started Seri on the call. */
  let call: AiCall | null = null;
  let conversation: Conversation | null = null;
  let setupSeen = false;
  let turns = 0;
  /** Each message waits for the one before it - only `setup` takes long. */
  let line: Promise<void> = Promise.resolve();
  /** Each write waits for the one before it, so turns are kept in the order said. Nothing on the call waits for them. */
  let writes: Promise<void> = Promise.resolve();

  const close = (code: number, reason: string) => {
    clearTimeout(setupTimer);
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason);
  };

  const refuse = (reason: string, fields: Record<string, unknown> = {}) => {
    log.warn('ai_relay.refused', { reason, ...fields });
    close(REFUSED, reason);
  };

  const setupTimer = setTimeout(() => {
    if (!setupSeen) refuse('no_setup');
  }, deps.setupTimeoutMs ?? SETUP_TIMEOUT_MS);

  const write = (what: () => Promise<unknown>, failed: (err: unknown) => void) => {
    writes = writes.then(what).then(
      () => undefined,
      (err: unknown) => failed(err)
    );
  };

  const keep = (turn: Omit<Turn, 'callId'>) => {
    const callId = call!.callId;
    write(
      async () => {
        await deps.store.saveTurn({ callId, ...turn });
        turns++;
      },
      (err) => log.error('ai_relay.turn_not_saved', { callId, who: turn.who, err: errText(err) })
    );
  };

  const send = (message: string) => {
    if (ws.readyState === ws.OPEN) ws.send(message);
  };

  const handle = async (msg: RelayMessage | null) => {
    if (msg === null) {
      log.warn('ai_relay.bad_message', { callId: call?.callId ?? null });
      return;
    }

    if (!setupSeen) {
      setupSeen = true;
      clearTimeout(setupTimer);
      if (msg.type !== 'setup') return refuse('no_setup', { first: msg.type });
      if (msg.callId === null || msg.callSid === '') return refuse('bad_setup');
      const settings = await deps.store.callSettings();
      if (!settings.script) {
        // Nothing to take her stop line and words from. The action URL is
        // asked next, and the call goes on there.
        log.error('ai_relay.no_script', { callId: msg.callId });
        close(FAILED, 'no_script');
        return;
      }
      const started = await deps.store.startAiCall({
        callId: msg.callId,
        callSid: msg.callSid,
        knowledgeVersion: deps.knowledge.version,
      });
      if (!started.ok) return refuse(started.reason, { callId: msg.callId, callSid: msg.callSid });
      const aiCall = started.call;
      call = aiCall;
      log.info('ai_relay.started', { callId: aiCall.callId, leadId: aiCall.leadId, callSid: msg.callSid });

      const now = deps.now?.() ?? new Date();
      // Twilio says the greeting itself, the moment the lead picks up (A13),
      // from the same function: it is what she has said so far.
      const greeting = welcomeGreeting(aiCall.firstName);
      conversation = new Conversation(
        {
          callId: aiCall.callId,
          instructions: buildInstructions({
            knowledge: deps.knowledge,
            lead: { firstName: aiCall.firstName, phone: aiCall.phone },
            now,
            hours: settings.hours,
            callbackNumber: deps.twilio.callerId,
            stopLine: settings.script.optOutBody,
          }),
          greeting,
          hours: settings.hours,
          stopLine: settings.script.optOutBody,
          optOutWords: settings.script.optOutWords,
        },
        {
          model: deps.model,
          whoIsThere: () => deps.store.whoIsThere(aiCall.callId),
          keep,
          ended: (handoff) =>
            write(
              () => deps.store.endAiCall(aiCall.callId, handoff),
              (err) => log.error('ai_relay.end_not_saved', { callId: aiCall.callId, action: handoff.action, err: errText(err) })
            ),
          send,
          now: deps.now,
          timers: deps.timers,
        }
      );
      keep({ who: 'seri', text: greeting });
      conversation.start();
      return;
    }
    // Refused, and closing.
    if (call === null || conversation === null) return;

    switch (msg.type) {
      case 'setup':
        log.warn('ai_relay.second_setup', { callId: call.callId });
        return;
      case 'prompt':
        if (!msg.last || msg.text === '') return;
        keep({ who: 'lead', text: msg.text });
        conversation.heard(msg.text);
        return;
      case 'dtmf':
        if (msg.digit === '') return;
        keep({ who: 'lead', text: keyTurn(msg.digit) });
        conversation.pressed(msg.digit);
        return;
      case 'interrupt':
        // Her turn first, then the note of what was heard of it.
        conversation.interrupted(msg.heard);
        keep({ who: 'system', text: interruptedNote(msg.heard) });
        return;
      case 'speaking':
        conversation.speaking(msg.who, msg.on);
        return;
      case 'error':
        log.warn('ai_relay.twilio_error', { callId: call.callId });
        keep({ who: 'system', text: twilioErrorNote(msg.description) });
        return;
      default:
        return;
    }
  };

  ws.on('message', (data: RawData, isBinary: boolean) => {
    const msg = isBinary ? null : parseRelayMessage(data.toString());
    line = line
      .then(() => handle(msg))
      .catch((err: unknown) => {
        log.error('ai_relay.failed', { callId: call?.callId ?? null, err: errText(err) });
        // Once she is talking, the session ends as hers does, with the
        // fallback; before, there is nothing to end, and closing is enough.
        if (conversation && !conversation.isOver) conversation.fail('relay_failed');
        else close(FAILED, 'failed');
      });
  });

  ws.on('close', (code: number) => {
    clearTimeout(setupTimer);
    // Whether her part had ended - with her action or a fallback - before the socket closed.
    const ended = conversation?.isOver ?? false;
    conversation?.close();
    if (call) {
      const callId = call.callId;
      void writes.then(() => log.info('ai_relay.closed', { callId, code, turns, ended }));
    }
  });

  ws.on('error', (err: Error) => {
    log.warn('ai_relay.socket_error', { callId: call?.callId ?? null, err: errText(err) });
    conversation?.fail('socket_error');
  });
}
