/**
 * Runs the answer test set against OpenAI - Phase 7, A09, docs/AI-AGENT.md
 * section 8. By hand, before every change to the knowledge files or the
 * instructions; never in CI: it calls OpenAI.
 *
 *   OPENAI_API_KEY=... npm run ai:eval                          Seri's model (model.ts)
 *   npm run ai:eval -- --model gpt-4.1-mini --model gpt-5.4-mini:none
 *   npm run ai:eval -- --case price --runs 3                    cases whose id starts "price", three times each
 *
 * A model is `name` or `name:effort` (reasoning effort, for the models that
 * reason). Prints each case, pass or fail and why, and for each model the
 * pass rate and the time to Seri's first word - the wait the lead hears.
 */

import OpenAI from 'openai';
import type { ReasoningEffort } from 'openai/resources/shared';
import { ACTION_TOOLS, type ToolCall } from '../actions';
import { loadKnowledge } from '../knowledge';
import { PROMPT_CACHE_KEY, SERI_MODEL } from '../model';
import { caseMessages, grade, loadCases, type EvalCase, type Grade } from './grade';

interface Model {
  name: string;
  effort?: ReasoningEffort;
}

interface Result extends Grade {
  id: string;
  text: string;
  /** Milliseconds to the first word or action. */
  firstMs: number;
  promptTokens: number;
  cachedTokens: number;
}

function parseArgs(argv: string[]): { models: Model[]; cases: string[]; runs: number; concurrency: number } {
  const models: Model[] = [];
  const cases: string[] = [];
  let runs = 1;
  let concurrency = 4;
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case '--model': {
        const [name, effort] = value.split(':');
        models.push({ name, effort: effort as ReasoningEffort | undefined });
        i++;
        break;
      }
      case '--case':
        cases.push(value);
        i++;
        break;
      case '--runs':
        runs = Math.max(1, Number(value) || 1);
        i++;
        break;
      case '--concurrency':
        concurrency = Math.max(1, Number(value) || 1);
        i++;
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(2);
    }
  }
  return { models: models.length > 0 ? models : [{ name: SERI_MODEL }], cases, runs, concurrency };
}

async function ask(client: OpenAI, model: Model, c: EvalCase): Promise<Result> {
  const knowledge = loadKnowledge();
  const started = Date.now();
  let firstMs = -1;
  let text = '';
  const calls: ToolCall[] = [];
  let promptTokens = 0;
  let cachedTokens = 0;

  const stream = await client.chat.completions.create({
    model: model.name,
    messages: caseMessages(c, knowledge),
    tools: ACTION_TOOLS,
    parallel_tool_calls: false,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: 600,
    prompt_cache_key: PROMPT_CACHE_KEY,
    ...(model.effort ? { reasoning_effort: model.effort } : {}),
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      if (firstMs < 0) firstMs = Date.now() - started;
      text += delta.content;
    }
    for (const call of delta?.tool_calls ?? []) {
      if (firstMs < 0) firstMs = Date.now() - started;
      const slot = (calls[call.index] ??= { name: '', arguments: '' });
      slot.name += call.function?.name ?? '';
      slot.arguments += call.function?.arguments ?? '';
    }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens;
      cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
    }
  }
  const reply = { text, toolCalls: calls.filter(Boolean) };
  return { id: c.id, text, firstMs, promptTokens, cachedTokens, ...grade(c, reply) };
}

/** Runs `jobs` with at most `limit` going at once, keeping their order. */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]();
      }
    })
  );
  return results;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
};

async function main(): Promise<void> {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set.');
    process.exit(2);
  }
  const { models, cases: filter, runs, concurrency } = parseArgs(process.argv.slice(2));
  const cases = loadCases().filter((c) => filter.length === 0 || filter.some((f) => c.id.startsWith(f)));
  const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  const summaries: string[] = [];

  for (const model of models) {
    const label = model.effort ? `${model.name} (reasoning ${model.effort})` : model.name;
    console.log(`\n${label} - ${cases.length} cases${runs > 1 ? `, ${runs} runs each` : ''}`);
    const jobs = cases.flatMap((c) =>
      Array.from({ length: runs }, () => () =>
        ask(client, model, c).catch(
          (err: Error): Result => ({
            id: c.id,
            text: '',
            firstMs: -1,
            promptTokens: 0,
            cachedTokens: 0,
            outcome: 'error',
            problems: [err.message],
            heard: '',
            defaultLine: false,
          })
        )
      )
    );
    const results = await pool(jobs, concurrency);

    for (const r of results) {
      const heard = `${r.defaultLine ? '(said for her) ' : ''}${r.heard.replace(/\s+/g, ' ').trim()}`;
      console.log(`${r.problems.length === 0 ? 'PASS' : 'FAIL'}  ${r.id.padEnd(26)} ${seconds(r.firstMs).padStart(6)}  ${r.outcome.padEnd(17)} ${heard}`);
      for (const p of r.problems) console.log(`        - ${p}`);
    }
    const passed = results.filter((r) => r.problems.length === 0).length;
    const firsts = results.filter((r) => r.firstMs >= 0).map((r) => r.firstMs);
    const prompt = results.reduce((sum, r) => sum + r.promptTokens, 0);
    const cached = results.reduce((sum, r) => sum + r.cachedTokens, 0);
    const summary =
      `${label}: ${passed}/${results.length} passed (${((100 * passed) / results.length).toFixed(1)}%), ` +
      `first word median ${seconds(percentile(firsts, 0.5))}, 90% within ${seconds(percentile(firsts, 0.9))}, ` +
      `prompt read from cache ${prompt ? Math.round((100 * cached) / prompt) : 0}%, ` +
      `last line said for her ${results.filter((r) => r.defaultLine).length} times`;
    console.log(`\n${summary}`);
    summaries.push(summary);
  }
  if (models.length > 1) console.log(`\n${summaries.join('\n')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
