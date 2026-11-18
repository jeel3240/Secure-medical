/**
 * Runs the speak step's cases against OpenAI - A29, docs/AI-AGENT.md section
 * 8. By hand, never in CI: it calls OpenAI.
 *
 *   OPENAI_API_KEY=... npm run ai:eval:speak -- [--model gpt-4.1-mini] [--runs 10] [--case end_]
 *
 * Each reply is marked as the call would say it - her tones taken out, every
 * sentence through the safety check - and must hold what the case asks and
 * nothing it forbids. Prints each failure, then the pass rate per move and the
 * time to her first word.
 */

import OpenAI from 'openai';
import type { ReasoningEffort } from 'openai/resources/shared';
import { DEFAULT_CALL_HOURS } from '../../core/auto-dial';
import { loadKnowledge } from '../knowledge';
import { SERI_MODEL } from '../model';
import { startState } from '../policy';
import { codeLines, replyBrief, speakMessages, speakSystem } from '../speak';
import { gradeSpeak } from './speak-grade';
import { SPEAK_CASES } from './speak-cases';

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const args = process.argv.slice(2);
  const arg = (name: string, all = false) => {
    const values = args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
    return all ? values : values[0];
  };
  const [modelName, effort] = ((arg('--model') as string | undefined) ?? SERI_MODEL).split(':');
  const runs = Math.max(1, Number(arg('--runs') ?? 3));
  const prefixes = arg('--case', true) as string[];
  const knowledge = loadKnowledge();
  const system = speakSystem({ knowledge, lead: { firstName: 'John', phone: '+14805551234' }, now: new Date('2026-11-11T19:00:00Z'), hours: DEFAULT_CALL_HOURS });
  const cases = SPEAK_CASES.filter((c) => prefixes.length === 0 || prefixes.some((p) => c.id.startsWith(p)));
  const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
  const jobs = cases.flatMap((c) => Array.from({ length: runs }, () => c));
  const results: { id: string; pass: boolean; ms: number }[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < jobs.length) {
        const c = jobs[next++];
        const started = Date.now();
        let first: number | null = null;
        let text = '';
        try {
          const stream = await client.chat.completions.create({
            model: modelName,
            ...(effort ? { reasoning_effort: effort as ReasoningEffort } : {}),
            stream: true,
            max_completion_tokens: 200,
            prompt_cache_key: 'seri-speak',
            messages: speakMessages(system, c.recent, replyBrief(c.moves, startState(), c.who, 'John'), codeLines(c.moves, 'four eight zero, four seven zero, eight two five nine')),
          });
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta && first === null) first = Date.now() - started;
            text += delta ?? '';
          }
          const graded = gradeSpeak(c, text);
          results.push({ id: c.id, pass: graded.pass, ms: first ?? Date.now() - started });
          if (!graded.pass) {
            console.log(`FAIL  ${c.id.padEnd(30)} ${text.replace(/\s+/g, ' ').slice(0, 170)}`);
            for (const p of graded.problems) console.log(`        - ${p}`);
          }
        } catch (err) {
          results.push({ id: c.id, pass: false, ms: Date.now() - started });
          console.log(`FAIL  ${c.id.padEnd(30)} error: ${err instanceof Error ? err.message : err}`);
        }
      }
    })
  );
  const passed = results.filter((r) => r.pass).length;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const byCase = new Map<string, { pass: number; all: number }>();
  for (const r of results) {
    const entry = byCase.get(r.id) ?? { pass: 0, all: 0 };
    entry.all += 1;
    entry.pass += r.pass ? 1 : 0;
    byCase.set(r.id, entry);
  }
  const weak = [...byCase].filter(([, v]) => v.pass < v.all).map(([id, v]) => `${id} ${v.pass}/${v.all}`);
  console.log(
    `\n${modelName}${effort ? `:${effort}` : ''}: ${passed}/${results.length} passed (${((100 * passed) / results.length).toFixed(1)}%); ` +
      `first word median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(2)}s, 90% within ${(times[Math.floor(times.length * 0.9)] / 1000).toFixed(2)}s` +
      (weak.length ? `\n  not every run: ${weak.join(', ')}` : '')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
