/**
 * Runs the understand step's labelled set against OpenAI - A28,
 * docs/AI-BRAIN.md, "Tests". By hand, never in CI: it calls OpenAI.
 *
 *   OPENAI_API_KEY=... npm run ai:eval:understand
 *   npm run ai:eval:understand -- --model gpt-5.6-luna:none --runs 3 --case call1
 *
 * Prints each failure and why, then for each model: how many passed, how
 * often stop, the wrong person and wanting a person were right when read, and
 * the time to the whole answer. The fast path is not asked: it needs no OpenAI.
 */

import OpenAI from 'openai';
import type { ReasoningEffort } from 'openai/resources/shared';
import { loadKnowledge } from '../knowledge';
import { UNDERSTAND_CACHE_KEY, UNDERSTAND_EFFORT, UNDERSTAND_MODEL } from '../model';
import { parseActs, understandFormat, understandMessages } from '../understand';
import { criticalPrecision, gradeUnderstand, loadUnderstandCases, type UnderstandCase } from './understand-grade';

interface Model {
  name: string;
  effort?: ReasoningEffort;
}

function parseArgs(argv: string[]) {
  const models: Model[] = [];
  const cases: string[] = [];
  let runs = 1;
  let concurrency = 6;
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--model') {
      const [name, effort] = value.split(':');
      models.push({ name, effort: effort as ReasoningEffort | undefined });
    } else if (argv[i] === '--case') cases.push(value);
    else if (argv[i] === '--runs') runs = Math.max(1, Number(value) || 1);
    else if (argv[i] === '--concurrency') concurrency = Math.max(1, Number(value) || 1);
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(2);
    }
    i++;
  }
  return { models: models.length ? models : [{ name: UNDERSTAND_MODEL, effort: UNDERSTAND_EFFORT }], cases, runs, concurrency };
}

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
};

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const { models, cases: prefixes, runs, concurrency } = parseArgs(process.argv.slice(2));
  const knowledge = loadKnowledge();
  const format = understandFormat(knowledge);
  const cases = loadUnderstandCases().filter((c) => prefixes.length === 0 || prefixes.some((p) => c.id.startsWith(p)));
  const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });

  for (const model of models) {
    const label = model.effort ? `${model.name}:${model.effort}` : model.name;
    const jobs = cases.flatMap((c) => Array.from({ length: runs }, () => c));
    const results: { c: UnderstandCase; labels: string[]; pass: boolean; ms: number; problems: string[] }[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < jobs.length) {
          const c = jobs[next++];
          const started = Date.now();
          try {
            const reply = await client.chat.completions.create({
              model: model.name,
              ...(model.effort ? { reasoning_effort: model.effort } : {}),
              messages: understandMessages(knowledge, { said: c.lead, seri: c.seri, before: c.before }),
              response_format: format as never,
              max_completion_tokens: 200,
              prompt_cache_key: UNDERSTAND_CACHE_KEY,
            });
            const ms = Date.now() - started;
            const graded = gradeUnderstand(c, parseActs(reply.choices[0]?.message?.content ?? '', knowledge));
            results.push({ c, labels: graded.labels, pass: graded.pass, ms, problems: graded.problems });
          } catch (err) {
            results.push({ c, labels: [], pass: false, ms: Date.now() - started, problems: [`error: ${err instanceof Error ? err.message : err}`] });
          }
        }
      })
    );
    for (const r of results.filter((x) => !x.pass).sort((a, b) => a.c.id.localeCompare(b.c.id))) {
      console.log(`FAIL  ${r.c.id.padEnd(34)} ${JSON.stringify(r.c.lead).slice(0, 60).padEnd(62)} ${r.labels.join(', ')}`);
      for (const p of r.problems) console.log(`        - ${p}`);
    }
    const passed = results.filter((r) => r.pass).length;
    const critical = criticalPrecision(results);
    const times = results.map((r) => r.ms);
    console.log(
      `\n${label}: ${passed}/${results.length} passed (${((100 * passed) / results.length).toFixed(1)}%); ` +
        Object.entries(critical)
          .map(([name, { read, right }]) => `${name} right ${right} of ${read} read`)
          .join(', ') +
        `; whole answer median ${(pct(times, 50) / 1000).toFixed(2)}s, 90% within ${(pct(times, 90) / 1000).toFixed(2)}s\n`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
