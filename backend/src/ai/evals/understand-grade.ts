/**
 * The understand step's labelled set, and how an answer is marked - A28,
 * docs/AI-AGENT.md section 8. Pure: `understand-run.ts` asks OpenAI, this decides.
 *
 * A case passes when every `want` group is found - "a|b": either - nothing
 * else is there but what `allow` lets pass, and a call-back time has the parts
 * `time` names. "not_interested" in a case takes any reason; "not_interested:
 * timing" only that one.
 */

import type { Act, SaidTime } from '../policy';
import { actLabel } from '../understand';
import casesFile from './understand-cases.json';

export interface UnderstandCase {
  id: string;
  source: string;
  before: { who: 'lead' | 'seri'; text: string }[];
  seri: string;
  lead: string;
  want: string[];
  allow: string[];
  time?: Partial<SaidTime>;
}

export function loadUnderstandCases(): UnderstandCase[] {
  return casesFile.cases.map((c) => ({
    ...c,
    before: c.before as UnderstandCase['before'],
    allow: (c as { allow?: string[] }).allow ?? [],
    time: (c as { time?: Partial<SaidTime> }).time,
  }));
}

/** A label stands for a wanted one: the same, or a reason given where any was wanted. */
function matches(label: string, wanted: string): boolean {
  return label === wanted || (wanted === 'not_interested' && label.startsWith('not_interested'));
}

export interface UnderstandGrade {
  pass: boolean;
  labels: string[];
  problems: string[];
}

export function gradeUnderstand(c: UnderstandCase, acts: Act[]): UnderstandGrade {
  const labels = acts.map(actLabel);
  const problems: string[] = [];
  const wanted = c.want.flatMap((g) => g.split('|'));
  for (const group of c.want) {
    const options = group.split('|');
    if (!labels.some((l) => options.some((o) => matches(l, o)))) problems.push(`missing ${group}`);
  }
  const found = problems.length === 0;
  for (const label of labels) {
    // Saying it is them is never wrong: it changes nothing once they have. Nor
    // is "other" beside what was wanted: the policy acts on the rest.
    if (label === 'confirm_identity' || (label === 'other' && found)) continue;
    if (![...wanted, ...c.allow].some((w) => matches(label, w))) problems.push(`not wanted: ${label}`);
  }
  if (c.time) {
    const said = acts.find((a): a is Extract<Act, { act: 'wants_callback' }> => a.act === 'wants_callback')?.time ?? null;
    for (const [part, value] of Object.entries(c.time) as [keyof SaidTime, SaidTime[keyof SaidTime]][]) {
      if ((said?.[part] ?? null) !== value) problems.push(`time ${part}: ${JSON.stringify(said?.[part] ?? null)}, wanted ${JSON.stringify(value)}`);
    }
  }
  return { pass: problems.length === 0, labels, problems };
}

/** The acts that end or move a call: how often, when they were read, they were right. */
export const CRITICAL: Readonly<Record<string, readonly string[]>> = {
  stop: ['stop'],
  wrong_person: ['wrong_person'],
  wants_person: ['wants_person'],
};

/** For each critical act: the cases where it was read, and of those, the ones where it was right. */
export function criticalPrecision(results: { c: UnderstandCase; labels: string[] }[]): Record<string, { read: number; right: number }> {
  const out: Record<string, { read: number; right: number }> = {};
  for (const [name, labels] of Object.entries(CRITICAL)) {
    const read = results.filter((r) => r.labels.some((l) => labels.includes(l)));
    const right = read.filter((r) => [...r.c.want.flatMap((g) => g.split('|')), ...r.c.allow].some((w) => labels.includes(w)));
    out[name] = { read: read.length, right: right.length };
  }
  return out;
}
