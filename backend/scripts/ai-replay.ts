/**
 * Whole-call replays - A32, docs/AI-BRAIN.md. By hand, never in CI:
 * it calls OpenAI.
 *
 *   OPENAI_API_KEY=... npm run ai:replay -- --real turns.json [--runs 5] [--call 112] [--show]
 *
 * Each real call's lead lines (call_ai_turns exported as JSON - callId, who,
 * text; the lead's name made "John") are said in order to the real
 * conversation with the real brain - understand and speak against the real
 * OpenAI, Twilio faked, the clock stopped at a Wednesday noon. The lines were
 * said to the brain of before, so the new one may hear them out of place; what
 * is checked is what must hold on any call:
 *
 *   - the opening, said once at most;
 *   - an offer to connect never with nobody free, never two replies running;
 *   - a call back booked only after the reply that said its time back;
 *   - after two clear no's, the call ended - a question asked with them answered first (call 140);
 *   - never "I don't know", "I can't provide that", or "connect you" with nobody free.
 */

import { readFileSync } from 'node:fs';
import { DEFAULT_CALL_HOURS } from '../src/core/auto-dial';
import { ANTIBIOTICS_CALL } from '../src/core/call-script-fixtures';
import * as logModule from '../src/lib/log';
import type { Handoff } from '../src/ai/actions';
import { Brain, type BrainRecord } from '../src/ai/brain';
import { Conversation } from '../src/ai/conversation';
import { FakeClock } from '../src/ai/fake-clock';
import type { WhoIsThere } from '../src/ai/instructions';
import { loadKnowledge } from '../src/ai/knowledge';
import { openAiSpeak, openAiUnderstand } from '../src/ai/openai';
import { NEVER_SAY, says } from '../src/ai/evals/speak-grade';

/** Who could take each call: someone free on the calls Jeel had his browser open, someone coming on call 108; else nobody. */
const WHO: Record<number, WhoIsThere> = { 88: 'free', 105: 'free', 106: 'free', 109: 'free', 108: 'coming' };
const NOW = new Date('2026-11-11T19:00:00Z');

interface Outcome {
  callId: number;
  problems: string[];
  transcript: string[];
  ended: string;
}

async function replay(callId: number, lines: string[], apiKey: string): Promise<Outcome> {
  const who = WHO[callId] ?? 'nobody';
  const records: BrainRecord[] = [];
  const kept: { who: string; text: string }[] = [];
  const ended: Handoff[] = [];
  const knowledge = loadKnowledge();
  const brain = new Brain(
    { callId, knowledge, lead: { firstName: 'John', phone: '+14805551234' }, now: () => NOW, hours: DEFAULT_CALL_HOURS, callbackNumber: '+14804708259', keep: (r) => records.push(r) },
    { understand: openAiUnderstand(apiKey), speak: openAiSpeak(apiKey) }
  );
  const conversation = new Conversation(
    { callId, greeting: 'Hi, is this John?', hours: DEFAULT_CALL_HOURS, stopLine: ANTIBIOTICS_CALL.optOutBody, optOutWords: ANTIBIOTICS_CALL.optOutWords },
    { model: brain, whoIsThere: async () => who, keep: (t) => kept.push(t), ended: (h) => ended.push(h), send: () => undefined, now: () => NOW, timers: new FakeClock() }
  );
  conversation.start();
  const transcript: string[] = [];
  for (const line of lines) {
    if (conversation.isOver) break;
    const before = kept.filter((k) => k.who === 'seri').length;
    const records0 = records.length;
    transcript.push(`  Lead: ${line}`);
    const key = /^\(pressed (\d)\)$/.exec(line);
    if (key) conversation.pressed(key[1]);
    else conversation.heard(line);
    const by = Date.now() + 20_000;
    while (Date.now() < by && !conversation.isOver && kept.filter((k) => k.who === 'seri').length === before) {
      if (records.length > records0 && records[records.length - 1].moves.length === 0) break; // nothing to say
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setTimeout(r, 50));
    const reply = kept.filter((k) => k.who === 'seri')[before];
    const moves = records.length > records0 ? records[records.length - 1].moves.map((m) => m.move + ('kind' in m ? `:${m.kind}` : '')).join(',') : '';
    transcript.push(`  Seri: ${reply?.text ?? '(nothing)'}${moves ? `   [${moves}]` : ''}`);
  }
  await new Promise((r) => setTimeout(r, 100));
  conversation.close();

  const problems: string[] = [];
  const openings = records.filter((r) => r.moves.some((m) => m.move === 'opening')).length;
  if (openings > 1) problems.push(`the opening said ${openings} times`);
  const connects = records.map((r) => r.moves.some((m) => m.move === 'offer' && m.kind === 'connect'));
  if (who === 'nobody' && connects.some(Boolean)) problems.push('an offer to connect with nobody free');
  connects.forEach((c, i) => {
    if (c && connects[i - 1]) problems.push(`an offer to connect two replies running (reply ${i + 1})`);
  });
  records.forEach((r, i) => {
    const booked = r.moves.some((m) => m.move === 'end' && m.handoff.action === 'book_callback');
    if (booked && !records[i - 1]?.moves.some((m) => m.move === 'confirm_time')) problems.push('a call back booked with no time said back first');
    // A question asked with the second no is answered before the goodbye - call 140, heard in A34 and as it should be:
    // a reply that answers the lead is not the call going on (review, 2026-11-22: the rule failed every run of it).
    const answers = r.moves.some((m) => m.move === 'answer' || m.move === 'specialist' || m.move === 'say_again' || m.move === 'which_next');
    if (r.record.nos >= 2 && !r.moves.some((m) => m.move === 'end') && !answers) problems.push(`two no's and the call went on (reply ${i + 1})`);
  });
  for (const k of kept.filter((t) => t.who === 'seri')) {
    for (const w of NEVER_SAY) if (says(k.text, w)) problems.push(`said "${w}": ${k.text}`);
    if (who === 'nobody' && /\bconnect(ing)? you\b/i.test(k.text)) problems.push(`"connect you" with nobody free: ${k.text}`);
  }
  const end = ended[0];
  return { callId, problems, transcript, ended: end ? `${end.action}${'reason' in end ? ` ${end.reason}` : ''}${'why' in end ? ` ${end.why}` : ''}` : 'still talking' };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = arg('--real');
  if (!file) throw new Error('--real turns.json is needed');
  const runs = Math.max(1, Number(arg('--runs') ?? 1));
  const only = arg('--call');
  const show = args.includes('--show');
  // Quiet: the relay's own log lines are not what is checked here.
  for (const level of ['info', 'warn', 'error'] as const) jest_free_mute(logModule.log, level);

  const rows = JSON.parse(readFileSync(file, 'utf8')) as { callId: number; who: string; text: string }[];
  const calls = new Map<number, string[]>();
  for (const r of rows) if (r.who === 'lead') calls.set(r.callId, [...(calls.get(r.callId) ?? []), r.text.replace(/\bJeel\b/g, 'John')]);
  const ids = [...calls.keys()].filter((id) => !only || String(id) === only);

  const results: Outcome[] = [];
  const jobs = ids.flatMap((id) => Array.from({ length: runs }, () => id));
  let next = 0;
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (next < jobs.length) {
        const id = jobs[next++];
        results.push(await replay(id, calls.get(id) as string[], apiKey));
      }
    })
  );
  for (const r of results.sort((a, b) => a.callId - b.callId)) {
    const mark = r.problems.length ? 'FAIL' : 'ok  ';
    console.log(`${mark} call ${r.callId} - ${r.ended}${r.problems.length ? `\n${r.problems.map((p) => `       - ${p}`).join('\n')}` : ''}`);
    if (show || r.problems.length) console.log(r.transcript.join('\n'));
  }
  const failed = results.filter((r) => r.problems.length).length;
  console.log(`\n${results.length - failed}/${results.length} replays held every rule (${ids.length} calls, ${runs} run${runs > 1 ? 's' : ''} each)`);
  // A replay that broke a rule fails the run, so it can stand in a check (review M39).
  process.exitCode = failed > 0 ? 1 : 0;
}

/** Silences the log without jest. */
function jest_free_mute(log: Record<string, unknown>, level: string): void {
  log[level] = () => undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
