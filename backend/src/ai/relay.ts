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
 *   reconnect   a `setup` after the line dropped - the api restarting, or the
 *               network (`applicationReconnect`): the call is picked back up
 *               from its kept turns (resume.ts), and what the lead said that
 *               she never answered is answered; her action, if she had chosen
 *               it, is carried out. One connection per call: a newer one
 *               takes over from one this api still holds
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
 * Stopping the api (`stop`, a deploy): each call's turns are written, then its
 * connection is closed with 1012, "Service Restart" - Twilio keeps the call,
 * buffers what the lead says, and reconnects once the api is back; Caddy holds
 * the reconnect while it restarts (Caddyfile). AI-AGENT.md section 2, "When
 * the line drops".
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
import type { CallScript } from '../core/call-script';
import { Conversation, type Timers } from './conversation';
import { buildInstructions, welcomeGreeting, type WhoIsThere } from './instructions';
import type { Knowledge } from './knowledge';
import type { SeriModel } from './openai';
import {
  endMessage,
  interruptedNote,
  keyTurn,
  parseRelayMessage,
  reconnectedNote,
  RELAY_PATH,
  relaySigned,
  twilioErrorNote,
  type RelayMessage,
} from './relay-messages';
import type { AiCall, CallSettings, RelayStore, Resumed, Turn } from './relay-store';
import { earlierConversation, type Earlier } from './resume';

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

/** How long `stop` waits for each call's turns to be written. */
const STOP_WAIT_MS = 2_000;

/**
 * WebSocket close codes: refused (policy); failed on our side, and the api
 * restarting - both of which Twilio reconnects after (`applicationReconnect`).
 */
const REFUSED = 1008;
const FAILED = 1011;
const RESTARTING = 1012;

/** One connection from Twilio, as the relay's other connections see it. */
interface Session {
  /** Twilio's call, once `setup` named it. */
  callSid: string | null;
  /** Ends this connection: `restart` closes it with 1012 for Twilio to reconnect; `replaced` cuts it - a newer one has the call. */
  drop(how: 'restart' | 'replaced'): void;
  /** Once the connection has closed. */
  closed: Promise<void>;
  /** Once every turn this connection kept so far is written. */
  settled(): Promise<void>;
}

/** The connections open now: each one, and the one each call is on. */
interface Sessions {
  open: Set<Session>;
  byCall: Map<number, Session>;
  stopping: boolean;
}

export interface Relay {
  wss: WebSocketServer;
  /** How many calls are with her now. */
  liveCalls(): number;
  /**
   * The api is stopping: no more connections taken, and each call's
   * connection closed with 1012 - Twilio keeps the call and reconnects once the
   * api is back - its turns written first, waiting `waitMs` at most.
   */
  stop(waitMs?: number): Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/**
 * Listens for the relay's WebSocket on the API's own server. Every other
 * WebSocket request is refused: the app has no other.
 */
export function attachRelay(server: Server, deps: RelayDeps): Relay {
  // A turn is a sentence or two; nothing Twilio sends comes near this.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const sessions: Sessions = { open: new Set(), byCall: new Map(), stopping: false };

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const path = url.split('?')[0];
    if (path !== RELAY_PATH) {
      log.warn('ai_relay.refused', { reason: 'not_found', path });
      refuseUpgrade(socket, 404);
      return;
    }
    if (sessions.stopping) {
      // A 5xx: Twilio tries again - by then, the api that has started.
      refuseUpgrade(socket, 503);
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
    wss.handleUpgrade(req, socket, head, (ws) => runSession(ws, deps, sessions));
  });

  return {
    wss,
    liveCalls: () => sessions.byCall.size,
    stop: async (waitMs = STOP_WAIT_MS) => {
      sessions.stopping = true;
      const open = [...sessions.open];
      for (const session of open) session.drop('restart');
      // Closed first: what the lead said meanwhile is kept too.
      await Promise.race([Promise.all(open.map((s) => s.closed.then(() => s.settled()))), pause(waitMs)]);
    },
  };
}

/** No WebSocket at all: a plain HTTP answer, then the connection closed. */
function refuseUpgrade(socket: Duplex, status: 403 | 404 | 503): void {
  const text = status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Service Unavailable';
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function runSession(ws: WebSocket, deps: RelayDeps, sessions: Sessions): void {
  /** Set once `setup` has started Seri on the call, or picked it back up. */
  let call: AiCall | null = null;
  let conversation: Conversation | null = null;
  let setupSeen = false;
  /** Her part had already ended when this connection picked the call up: it carried her action out, and nothing more. */
  let endedBefore = false;
  /** Another connection has the call now, or the api is stopping: nothing more is done here. */
  let dropped = false;
  /** The call this connection is listed under (`takeCall`). */
  let listedAs: number | null = null;
  let turns = 0;
  /** Each message waits for the one before it - only `setup` takes long. */
  let line: Promise<void> = Promise.resolve();
  /** Each write waits for the one before it, so turns are kept in the order said. Nothing on the call waits for them. */
  let writes: Promise<void> = Promise.resolve();

  const close = (code: number, reason: string) => {
    clearTimeout(setupTimer);
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason);
  };

  const session: Session = {
    callSid: null,
    drop: (how) => {
      dropped = true;
      conversation?.close();
      if (how === 'restart') close(RESTARTING, 'restarting');
      else ws.terminate();
    },
    closed: new Promise<void>((resolve) => ws.once('close', () => resolve())),
    settled: () => writes,
  };
  sessions.open.add(session);

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

  /** This connection has the call: one this api still holds for it - the line that dropped - is cut, and its turns written first. */
  const takeCall = async (callId: number, callSid: string) => {
    session.callSid = callSid;
    const before = sessions.byCall.get(callId);
    if (before && before !== session && before.callSid === callSid) {
      log.warn('ai_relay.replaced', { callId });
      before.drop('replaced');
      await Promise.race([before.settled(), pause(STOP_WAIT_MS)]);
    }
    sessions.byCall.set(callId, session);
    listedAs = callId;
  };

  const begin = (aiCall: AiCall, script: CallScript, settings: CallSettings, earlier?: Earlier): Conversation => {
    const now = deps.now?.() ?? new Date();
    return new Conversation(
      {
        callId: aiCall.callId,
        instructions: buildInstructions({
          knowledge: deps.knowledge,
          lead: { firstName: aiCall.firstName, phone: aiCall.phone },
          now,
          hours: settings.hours,
          callbackNumber: deps.twilio.callerId,
          stopLine: script.optOutBody,
        }),
        // Twilio says the greeting itself, the moment the lead picks up (A13),
        // from the same function: it is what she has said so far.
        greeting: welcomeGreeting(aiCall.firstName),
        hours: settings.hours,
        stopLine: script.optOutBody,
        optOutWords: script.optOutWords,
        earlier,
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
        verdict: () => deps.store.verdict(aiCall.callId),
        now: deps.now,
        timers: deps.timers,
      }
    );
  };

  /** The call picked back up after the line dropped: her action carried out if she had chosen it, else the conversation goes on. */
  const pickUp = async (resumed: Resumed, script: CallScript, settings: CallSettings, attempt: number | null) => {
    const aiCall = resumed.call;
    call = aiCall;
    keep({ who: 'system', text: reconnectedNote(attempt) });
    const fields = { callId: aiCall.callId, leadId: aiCall.leadId, attempt, turns: resumed.turns.length };
    if (resumed.ended) {
      const handoff = resumed.ended;
      endedBefore = true;
      log.info('ai_relay.resumed', { ...fields, ended: handoff.action });
      write(
        () => deps.store.endAiCall(aiCall.callId, handoff),
        (err) => log.error('ai_relay.end_not_saved', { callId: aiCall.callId, action: handoff.action, err: errText(err) })
      );
      send(endMessage(handoff));
      return;
    }
    let who: WhoIsThere = 'nobody';
    try {
      who = await deps.store.whoIsThere(aiCall.callId);
    } catch (err) {
      // Nobody, so she never promises a transfer that cannot happen.
      log.error('ai_relay.who_failed', { callId: aiCall.callId, err: errText(err) });
    }
    const earlier: Earlier = {
      ...earlierConversation(resumed.turns, welcomeGreeting(aiCall.firstName), who),
      startedAt: resumed.startedAt,
    };
    if (dropped) return;
    conversation = begin(aiCall, script, settings, earlier);
    log.info('ai_relay.resumed', { ...fields, answering: earlier.pending.length > 0 });
    conversation.start();
  };

  const handle = async (msg: RelayMessage | null) => {
    if (dropped) {
      // The api is stopping: what the lead said as the line closed is still
      // kept - the call picked back up answers it. Nothing else is done here.
      if (call && msg?.type === 'prompt' && msg.last && msg.text !== '') keep({ who: 'lead', text: msg.text });
      return;
    }
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
      const script = settings.script;
      if (!script) {
        // Nothing to take her stop line and words from. The action URL is
        // asked next, and the call goes on there.
        log.error('ai_relay.no_script', { callId: msg.callId });
        close(FAILED, 'no_script');
        return;
      }
      if (msg.reconnect) {
        // The line dropped: this api's connection for the call, if it still
        // has one, is cut and its turns written - they are the call so far.
        await takeCall(msg.callId, msg.callSid);
        const resumed = await deps.store.resumeAiCall({ callId: msg.callId, callSid: msg.callSid, attempt: msg.attempt });
        if (resumed.ok) return pickUp(resumed, script, settings, msg.attempt);
        // She never took it - the line dropped before her first connection
        // got that far: she takes it now, from her greeting.
        if (resumed.reason !== 'not_started') {
          return refuse(resumed.reason, { callId: msg.callId, callSid: msg.callSid, reconnect: true });
        }
      }
      const started = await deps.store.startAiCall({
        callId: msg.callId,
        callSid: msg.callSid,
        knowledgeVersion: deps.knowledge.version,
      });
      if (!started.ok) return refuse(started.reason, { callId: msg.callId, callSid: msg.callSid });
      const aiCall = started.call;
      call = aiCall;
      if (!msg.reconnect) await takeCall(aiCall.callId, msg.callSid);
      log.info('ai_relay.started', { callId: aiCall.callId, leadId: aiCall.leadId, callSid: msg.callSid });
      if (dropped) return;
      conversation = begin(aiCall, script, settings);
      keep({ who: 'seri', text: welcomeGreeting(aiCall.firstName) });
      conversation.start();
      return;
    }
    // Refused, and closing - or her part was over when the call was picked up.
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
        // fallback; before, there is nothing to end, and closing is enough -
        // Twilio reconnects after a 1011, and the call is taken or picked up then.
        if (conversation && !conversation.isOver) conversation.fail('relay_failed');
        else close(FAILED, 'failed');
      });
  });

  ws.on('close', (code: number) => {
    clearTimeout(setupTimer);
    sessions.open.delete(session);
    // Whether her part had ended - with her action or a fallback - before the socket closed.
    const ended = endedBefore || (conversation?.ended ?? false);
    conversation?.close();
    if (listedAs !== null && sessions.byCall.get(listedAs) === session) sessions.byCall.delete(listedAs);
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
