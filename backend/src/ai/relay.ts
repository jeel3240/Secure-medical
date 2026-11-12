/**
 * The relay: Seri's side of a ConversationRelay call - A10, docs/AI-AGENT.md
 * sections 1, 6 and 9.
 *
 * Twilio opens a WebSocket to `/api/ai/relay` when an automated call is
 * connected to Seri (A13), sends what the lead says as text, and speaks what
 * we send back. This part is the pipe: who may connect, which call it is, and
 * every turn kept. What Seri answers is `deps.reply` - one fixed line until
 * OpenAI is added (A11).
 *
 *   connection  refused unless signed by Twilio for the relay's own address
 *   setup       names our `calls` row; Seri starts it once (relay-store.ts),
 *               and her greeting - which Twilio says itself - is her first turn
 *   prompt      the lead's words, then her reply: two turns
 *   dtmf        the key, as the lead's turn
 *   interrupt   what she had said when the lead spoke over her, as a note
 *
 * Messages are handled one at a time, in the order they came, so the turns are
 * kept in the order they were said. A turn that cannot be saved is logged and
 * the call goes on: the lead is talking to her.
 */

import type { Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { errText, log } from '../lib/log';
import { welcomeGreeting } from './instructions';
import {
  interruptedNote,
  keyTurn,
  parseRelayMessage,
  RELAY_PATH,
  relaySigned,
  textMessage,
  twilioErrorNote,
  type RelayMessage,
} from './relay-messages';
import type { AiCall, RelayStore, Turn } from './relay-store';

export interface RelayDeps {
  /** From calling's settings: the token signatures are checked with, and our public address. */
  twilio: { authToken: string; publicUrl: string };
  /** The version of Seri's knowledge files, kept on each call she takes. */
  knowledgeVersion: string;
  store: RelayStore;
  /** What Seri answers to what the lead said. */
  reply: (call: AiCall, said: string) => string;
  /** How long Twilio has, once connected, to send `setup`. */
  setupTimeoutMs?: number;
}

/** Seri's one line until she has OpenAI (A11). Never reaches a lead: no call goes to her before A13. */
export const FIXED_LINE = 'Thanks. Someone from our team will be in touch soon.';

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
  let setupSeen = false;
  let turns = 0;
  /** Each message waits for the one before it. */
  let line: Promise<void> = Promise.resolve();

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

  const keep = async (turn: Omit<Turn, 'callId'>) => {
    const callId = call!.callId;
    try {
      await deps.store.saveTurn({ callId, ...turn });
      turns++;
    } catch (err) {
      log.error('ai_relay.turn_not_saved', { callId, who: turn.who, err: errText(err) });
    }
  };

  const say = (text: string) => {
    if (ws.readyState === ws.OPEN) ws.send(textMessage(text));
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
      const started = await deps.store.startAiCall({
        callId: msg.callId,
        callSid: msg.callSid,
        knowledgeVersion: deps.knowledgeVersion,
      });
      if (!started.ok) return refuse(started.reason, { callId: msg.callId, callSid: msg.callSid });
      call = started.call;
      log.info('ai_relay.started', { callId: call.callId, leadId: call.leadId, callSid: msg.callSid });
      // Twilio says the greeting itself, the moment the lead picks up (A13),
      // from the same function: it is what she has said so far.
      await keep({ who: 'seri', text: welcomeGreeting(call.firstName) });
      return;
    }
    // Refused, and closing.
    if (call === null) return;

    switch (msg.type) {
      case 'setup':
        log.warn('ai_relay.second_setup', { callId: call.callId });
        return;
      case 'prompt': {
        if (!msg.last || msg.text === '') return;
        const heardAt = Date.now();
        const reply = deps.reply(call, msg.text);
        say(reply);
        const latencyMs = Date.now() - heardAt;
        await keep({ who: 'lead', text: msg.text });
        await keep({ who: 'seri', text: reply, latencyMs });
        return;
      }
      case 'dtmf':
        if (msg.digit !== '') await keep({ who: 'lead', text: keyTurn(msg.digit) });
        return;
      case 'interrupt':
        await keep({ who: 'system', text: interruptedNote(msg.heard) });
        return;
      case 'error':
        log.warn('ai_relay.twilio_error', { callId: call.callId });
        await keep({ who: 'system', text: twilioErrorNote(msg.description) });
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
        close(FAILED, 'failed');
      });
  });

  ws.on('close', (code: number) => {
    clearTimeout(setupTimer);
    if (call) log.info('ai_relay.closed', { callId: call.callId, code, turns });
  });

  ws.on('error', (err: Error) => {
    log.warn('ai_relay.socket_error', { callId: call?.callId ?? null, err: errText(err) });
  });
}
