/**
 * How fast each way of making Seri's reply is - A24, docs/AI-AGENT.md section
 * 12 ("The brain"). By hand, never in CI: it calls OpenAI.
 *
 *   OPENAI_API_KEY=... npm run ai:bakeoff -- [--real turns.json] [--limit N] [--concurrency 6] [--out results.json]
 *
 * Every lead line - the answer test set's last lead turns, and with `--real`
 * the lead lines of real calls (call_ai_turns exported as JSON: callId, who,
 * text) - is asked four ways, the order shuffled so each way meets OpenAI's
 * good and bad minutes alike:
 *
 *   baseline     today's brain: the whole instructions, the five actions as
 *                tools, one streamed call - the time to the first word or action
 *   understand   a stand-in for the new first step: a short prompt, strict
 *                JSON acts - the time to the whole answer
 *   speak        a stand-in for the new second step: her persona and a move
 *                brief, streamed - the time to the first word
 *   single       one call writing acts, move and words as JSON - the time to
 *                the first character of the words
 *
 * Only the times are measured here; how well each model understands and
 * speaks is A28's and A29's to measure. The prompts are stand-ins of the
 * length the real ones will have. The two-step time is understand + speak on
 * the same line; a turn whose move is an approved answer, sent by code, waits
 * for understand alone.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ReasoningEffort } from 'openai/resources/shared';
import { ACTION_TOOLS } from '../src/ai/actions';
import { caseMessages, loadCases, type EvalCase } from '../src/ai/evals/grade';
import { CALL_HEADING } from '../src/ai/instructions';
import { loadKnowledge, type Knowledge } from '../src/ai/knowledge';
import { PROMPT_CACHE_KEY, SERI_MODEL } from '../src/ai/model';
import { spokenWords } from '../src/ai/tone';

interface Model {
  name: string;
  effort?: ReasoningEffort;
}

const UNDERSTAND_MODELS: Model[] = [
  { name: 'gpt-4.1-mini' },
  { name: 'gpt-4o-mini' },
  { name: 'gpt-5-nano', effort: 'minimal' },
  { name: 'gpt-5.4-nano', effort: 'none' },
  { name: 'gpt-5.4-mini', effort: 'none' },
  { name: 'gpt-5.6-luna', effort: 'none' },
  { name: 'gpt-5.6-terra', effort: 'none' },
  { name: 'gpt-6-luna', effort: 'none' },
];

const SPEAK_MODELS: Model[] = [
  { name: 'gpt-4.1-mini' },
  { name: 'gpt-5.4-mini', effort: 'none' },
  { name: 'gpt-5.5', effort: 'none' },
  { name: 'gpt-5.6-luna', effort: 'none' },
  { name: 'gpt-5.6-terra', effort: 'none' },
  { name: 'gpt-6-luna', effort: 'none' },
];

const SINGLE_MODELS: Model[] = [{ name: 'gpt-4.1-mini' }, { name: 'gpt-5.6-terra', effort: 'none' }];

const label = (m: Model) => (m.effort ? `${m.name}:${m.effort}` : m.name);

// ---------------------------------------------------------------------------
// The lines

interface Line {
  id: string;
  /** Today's request: the instructions and the call so far, the line last. */
  baseline: ChatCompletionMessageParam[];
  /** The conversation so far as plain turns - her greeting first - the line last. */
  turns: { who: 'lead' | 'seri'; text: string }[];
}

function fromCase(c: EvalCase, knowledge: Knowledge): Line {
  const baseline = caseMessages(c, knowledge);
  const turns = baseline.slice(1).flatMap((m): Line['turns'] => {
    if (m.role === 'assistant' && typeof m.content === 'string') return [{ who: 'seri', text: spokenWords(m.content) }];
    if (m.role === 'user' && typeof m.content === 'string') return [{ who: 'lead', text: m.content.replace(/^\[[^\]]*\]\s*/, '') }];
    return [];
  });
  return { id: c.id, baseline, turns };
}

/** Real calls' lead lines, each with its call so far - the lead's name made "John", as in the test set. */
function fromRealCalls(file: string, knowledge: Knowledge, template: EvalCase): Line[] {
  const rows = JSON.parse(readFileSync(file, 'utf8')) as { callId: number; who: 'lead' | 'seri'; text: string }[];
  const byCall = new Map<number, typeof rows>();
  for (const row of rows) byCall.set(row.callId, [...(byCall.get(row.callId) ?? []), row]);
  const lines: Line[] = [];
  for (const [callId, callRows] of byCall) {
    const said = callRows.slice(1).map((r) => ({ ...r, text: r.text.replace(/\bJeel\b/g, 'John') }));
    said.forEach((row, i) => {
      if (row.who !== 'lead') return;
      const turns = said.slice(0, i + 1).map((r) => (r.who === 'lead' ? { lead: r.text } : { seri: r.text }));
      const c: EvalCase = { ...template, id: `call${callId}-${i}`, opened: false, turns, who: 'nobody' };
      lines.push(fromCase(c, knowledge));
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The stand-in prompts

const ACTS = [
  'confirm_identity', 'interested', 'not_interested', 'not_now', 'wants_person', 'wants_callback', 'agrees', 'declines',
  'asks', 'objection', 'emergency', 'wrong_person', 'stop', 'unclear', 'checking_line', 'backchannel', 'machine', 'other',
] as const;

function understandSystem(knowledge: Knowledge): string {
  return [
    'You label what a caller just said on a sales phone call from Seri at eDrugstore. You never reply to them.',
    'Return every act in what they said, in order. Their words reach you as speech turned into text and may be misheard: a line that makes no sense where it comes is "unclear".',
    '',
    'Acts - label each with one of the given labels: "asks:<answer id>" for a question, "objection_<n>" for an objection; reason only with not_interested, time only with wants_callback:',
    '- confirm_identity: they say it is them. interested: they want the offer. not_interested (reason closed | timing | product): they turn it down.',
    '- not_now: not now, without turning it down. wants_person: they ask for a person. wants_callback: they ask to be called later - day, hour, minute, am/pm as they said them, or null.',
    '- agrees / declines: yes or no to the question Seri just asked. asks (topic: an answer id below, or uncovered, medical, price, real_person, personal_details).',
    '- objection (topic: an objection below). emergency. wrong_person: only when they say so plainly. stop: they ask not to be called again.',
    '- unclear: misheard or makes no sense. checking_line: "hello?", "are you there?". backchannel: "okay", "uh huh" with nothing asked or answered. machine: a voicemail greeting or menu. other.',
    '',
    'Answer ids:',
    ...knowledge.answers.map((a) => `- ${a.id}: ${a.questions.slice(0, 3).join(' / ')}`),
    '',
    'Objections:',
    ...knowledge.playbook.objections.map((o, i) => `- objection_${i + 1}: ${o.leadSays.join(' / ')}`),
  ].join('\n');
}

function understandMessages(line: Line, knowledge: Knowledge): ChatCompletionMessageParam[] {
  const said = line.turns[line.turns.length - 1].text;
  const before = line.turns.slice(-5, -1).map((t) => `${t.who === 'seri' ? 'Seri' : 'Caller'}: ${t.text}`);
  return [
    { role: 'system', content: understandSystem(knowledge) },
    { role: 'user', content: `The call so far:\n${before.join('\n')}\n\nThe caller just said: ${said}` },
  ];
}

/**
 * Acts as short labels - "asks:shipping", "objection_3" - so the answer is a
 * few words: every word OpenAI writes is time the lead waits.
 */
function actLabels(knowledge: Knowledge): string[] {
  const topics = [...knowledge.answers.map((a) => a.id), 'uncovered', 'medical', 'price', 'real_person', 'personal_details'];
  return [
    ...ACTS.filter((a) => a !== 'asks' && a !== 'objection'),
    ...topics.map((t) => `asks:${t}`),
    ...knowledge.playbook.objections.map((_, i) => `objection_${i + 1}`),
  ];
}

function actsSchema(knowledge: Knowledge) {
  return {
    acts: { type: 'array', items: { type: 'string', enum: actLabels(knowledge) } },
    reason: { type: ['string', 'null'], enum: ['closed', 'timing', 'product', null] },
    time: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['day', 'hour', 'minute', 'ampm'],
          properties: {
            day: { type: ['string', 'null'] },
            hour: { type: ['integer', 'null'] },
            minute: { type: ['integer', 'null'] },
            ampm: { type: ['string', 'null'], enum: ['am', 'pm', null] },
          },
        },
      ],
    },
  };
}

function understandFormat(knowledge: Knowledge) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'acts',
      strict: true,
      schema: { type: 'object', additionalProperties: false, required: ['acts', 'reason', 'time'], properties: actsSchema(knowledge) },
    },
  };
}

function singleFormat(knowledge: Knowledge) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'reply',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['acts', 'reason', 'time', 'move', 'words'],
        properties: {
          ...actsSchema(knowledge),
          move: { type: 'string', enum: ['answer', 'ask_why', 'offer', 'ask_time', 'confirm_time', 'goodbye', 'ask_repeat', 'other'] },
          words: { type: 'string' },
        },
      },
    },
  };
}

/** Her persona: today's instructions without the call flow, the actions and the answers - about the length the real one will have. */
function speakSystem(baseline: ChatCompletionMessageParam[]): string {
  const all = String(baseline[0].content);
  const persona = all.slice(0, all.indexOf('## How the call goes'));
  return `${persona}\n${all.slice(all.indexOf(CALL_HEADING))}`;
}

const BRIEF =
  'Your move now: reply to what they just said in one or two short sentences, from what you know, then ask if there is anything else they would like to know. Never a price, never medical advice.';

function speakMessages(line: Line): ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: speakSystem(line.baseline) },
    ...line.turns.slice(-6).map((t): ChatCompletionMessageParam => (t.who === 'seri' ? { role: 'assistant', content: t.text } : { role: 'user', content: t.text })),
    { role: 'system', content: BRIEF },
  ];
}

// ---------------------------------------------------------------------------
// Asking

type Way = 'baseline' | 'understand' | 'speak' | 'single';

interface Sample {
  line: string;
  way: Way;
  model: string;
  /** To the first word (baseline, speak), the whole answer (understand), the words' first character (single). */
  ms: number | null;
  output: string;
  error?: string;
}

async function ask(client: OpenAI, way: Way, model: Model, line: Line, knowledge: Knowledge): Promise<Sample> {
  const started = Date.now();
  const sample: Sample = { line: line.id, way, model: label(model), ms: null, output: '' };
  const common = { model: model.name, stream: true as const, ...(model.effort ? { reasoning_effort: model.effort } : {}) };
  try {
    if (way === 'baseline') {
      const stream = await client.chat.completions.create({
        ...common,
        messages: line.baseline,
        tools: ACTION_TOOLS,
        parallel_tool_calls: false,
        max_completion_tokens: 300,
        prompt_cache_key: PROMPT_CACHE_KEY,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if ((delta?.content || delta?.tool_calls?.length) && sample.ms === null) sample.ms = Date.now() - started;
        sample.output += delta?.content ?? '';
        for (const t of delta?.tool_calls ?? []) sample.output += t.function?.name ? `<${t.function.name}>` : '';
      }
    } else if (way === 'understand') {
      const stream = await client.chat.completions.create({
        ...common,
        messages: understandMessages(line, knowledge),
        response_format: understandFormat(knowledge),
        max_completion_tokens: 300,
        prompt_cache_key: 'seri-understand-bakeoff',
      });
      for await (const chunk of stream) sample.output += chunk.choices[0]?.delta?.content ?? '';
      sample.ms = Date.now() - started;
    } else if (way === 'speak') {
      const stream = await client.chat.completions.create({
        ...common,
        messages: speakMessages(line),
        max_completion_tokens: 300,
        prompt_cache_key: 'seri-speak-bakeoff',
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text && sample.ms === null) sample.ms = Date.now() - started;
        sample.output += text ?? '';
      }
    } else {
      const stream = await client.chat.completions.create({
        ...common,
        messages: [{ role: 'system', content: `${speakSystem(line.baseline)}\n\n${understandSystem(knowledge)}` }, ...speakMessages(line).slice(1)],
        response_format: singleFormat(knowledge),
        max_completion_tokens: 400,
        prompt_cache_key: 'seri-single-bakeoff',
      });
      for await (const chunk of stream) {
        sample.output += chunk.choices[0]?.delta?.content ?? '';
        if (sample.ms === null && /"words"\s*:\s*"[^"]/.test(sample.output)) sample.ms = Date.now() - started;
      }
    }
  } catch (err) {
    sample.error = err instanceof Error ? err.message.slice(0, 120) : String(err);
  }
  return sample;
}

// ---------------------------------------------------------------------------
// Summing up

function pct(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const s = (ms: number) => (ms / 1000).toFixed(2);

function report(samples: Sample[]): void {
  const by = (way: Way, model: string) => new Map(samples.filter((x) => x.way === way && x.model === model && x.ms !== null).map((x) => [x.line, x.ms as number]));
  const row = (name: string, values: number[], errors = 0) =>
    console.log(`${name.padEnd(42)} median ${s(pct(values, 50))}  p90 ${s(pct(values, 90))}  n ${values.length}${errors ? `  errors ${errors}` : ''}`);
  const errorsOf = (way: Way, model: string) => samples.filter((x) => x.way === way && x.model === model && x.error).length;

  console.log('\nOne step, as today (first word or action):');
  for (const m of [{ name: SERI_MODEL }]) row(`baseline ${label(m)}`, [...by('baseline', label(m)).values()], errorsOf('baseline', label(m)));
  console.log('\nUnderstand alone (whole answer) - also the wait when the move is an approved answer:');
  for (const m of UNDERSTAND_MODELS) row(`understand ${label(m)}`, [...by('understand', label(m)).values()], errorsOf('understand', label(m)));
  console.log('\nSpeak alone (first word):');
  for (const m of SPEAK_MODELS) row(`speak ${label(m)}`, [...by('speak', label(m)).values()], errorsOf('speak', label(m)));
  console.log('\nTwo steps, understand + speak on the same line (first word):');
  for (const u of UNDERSTAND_MODELS) {
    for (const sp of SPEAK_MODELS) {
      const und = by('understand', label(u));
      const spk = by('speak', label(sp));
      const sums = [...und].filter(([line]) => spk.has(line)).map(([line, ms]) => ms + (spk.get(line) as number));
      row(`${label(u)} + ${label(sp)}`, sums);
    }
  }
  console.log('\nOne call writing acts, move and words (first character of the words):');
  for (const m of SINGLE_MODELS) row(`single ${label(m)}`, [...by('single', label(m)).values()], errorsOf('single', label(m)));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const knowledge = loadKnowledge();
  const cases = loadCases();
  let lines = cases.map((c) => fromCase(c, knowledge));
  const real = arg('--real');
  if (real) lines.push(...fromRealCalls(real, knowledge, cases[0]));
  const limit = Number(arg('--limit') ?? 0);
  if (limit > 0) lines = lines.slice(0, limit);
  const concurrency = Number(arg('--concurrency') ?? 6);

  const jobs: (() => Promise<Sample>)[] = [];
  const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
  for (const line of lines) {
    jobs.push(() => ask(client, 'baseline', { name: SERI_MODEL }, line, knowledge));
    for (const m of UNDERSTAND_MODELS) jobs.push(() => ask(client, 'understand', m, line, knowledge));
    for (const m of SPEAK_MODELS) jobs.push(() => ask(client, 'speak', m, line, knowledge));
    for (const m of SINGLE_MODELS) jobs.push(() => ask(client, 'single', m, line, knowledge));
  }
  // Shuffled: every way meets OpenAI's good and bad minutes alike.
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
  }
  console.log(`${lines.length} lines, ${jobs.length} requests, ${concurrency} at a time - started ${new Date().toISOString()}`);
  const samples: Sample[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        samples.push(await job());
        if (samples.length % 100 === 0) console.log(`  ${samples.length} of ${jobs.length}`);
      }
    })
  );
  console.log(`finished ${new Date().toISOString()}`);
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify(samples, null, 1));
  report(samples);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
