/**
 * What Seri knows - docs/AI-AGENT.md section 5: three JSON files in
 * `knowledge/`, imported here so the build carries them into `dist/`, checked
 * once, and handed out typed.
 *
 * A broken file must never reach a live call. `api/index.ts` loads them at
 * start-up and refuses to start on any problem, each named by file and field;
 * the files are in the repo, so the tests (knowledge.test.ts) find it first.
 *
 * Two things never get past this file:
 * - **Prices.** `site_price_usd` is in products.json for reference only; a
 *   product here has no field for it.
 * - **An answer not yet confirmed.** One that `needs_confirmation` carries a
 *   `fallback_answer`, and that is all Seri gets of it (`spoken`).
 */

import answersFile from './knowledge/answers.json';
import productsFile from './knowledge/products.json';
import playbookFile from './knowledge/sales-playbook.json';

export type AnswerStatus = 'approved' | 'needs_confirmation';

export interface KnowledgeAnswer {
  id: string;
  topic: string;
  /** How a lead might ask it - examples, not words to match. */
  questions: string[];
  /** What Seri may say: the answer once approved, its `fallback_answer` until then. */
  spoken: string;
  status: AnswerStatus;
  source: string;
}

export type ProductType = 'antibiotic' | 'antiviral' | 'kit' | 'test_kit';

export interface KnowledgeProduct {
  slug: string;
  name: string;
  type: ProductType;
  rxRequired: boolean;
  spokenLine: string;
  url: string;
}

export interface Objection {
  leadSays: string[];
  approach: string;
  example: string;
}

export interface SalesPlaybook {
  style: string[];
  objections: Objection[];
  closing: { situation: string; ask: string }[];
  never: string[];
  learning: string;
}

export interface Knowledge {
  /** The one version all three files share - saved with every call Seri takes. */
  version: string;
  rules: string[];
  answers: KnowledgeAnswer[];
  products: KnowledgeProduct[];
  playbook: SalesPlaybook;
}

/** The files as read - anything at all, until checked. */
export interface KnowledgeFiles {
  answers: unknown;
  products: unknown;
  playbook: unknown;
}

const STATUSES: readonly AnswerStatus[] = ['approved', 'needs_confirmation'];
const PRODUCT_TYPES: readonly ProductType[] = ['antibiotic', 'antiviral', 'kit', 'test_kit'];

/** The only placeholder a spoken line may hold: the number the call came from, filled in by A04. */
const ALLOWED_PLACEHOLDERS = new Set(['{callback_number}']);

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Collects every problem in one file, each with the file's name and the field's path. */
class FileCheck {
  readonly problems: string[] = [];
  constructor(private readonly file: string) {}

  problem(where: string, what: string): void {
    this.problems.push(`${this.file}: ${where} ${what}`);
  }

  text(o: Obj, key: string, where: string): string {
    const path = where ? `${where}.${key}` : key;
    const v = o[key];
    if (typeof v !== 'string') {
      this.problem(path, 'is missing');
      return '';
    }
    if (v.trim() === '') this.problem(path, 'is empty');
    return v;
  }

  /** A line Seri may say: a text, with no placeholder but the allowed one. */
  spoken(o: Obj, key: string, where: string): string {
    const v = this.text(o, key, where);
    for (const found of v.match(/\{[^}]*\}/g) ?? []) {
      if (!ALLOWED_PLACEHOLDERS.has(found)) this.problem(`${where}.${key}`, `holds ${found}, which nothing fills in`);
    }
    return v;
  }

  texts(o: Obj, key: string, where: string): string[] {
    const path = where ? `${where}.${key}` : key;
    const v = o[key];
    if (!Array.isArray(v) || v.length === 0) {
      this.problem(path, 'is missing or empty');
      return [];
    }
    v.forEach((item, i) => {
      if (typeof item !== 'string' || item.trim() === '') this.problem(`${path}[${i}]`, 'is empty');
    });
    return v.filter((item): item is string => typeof item === 'string');
  }

  list(o: Obj, key: string): Obj[] {
    const v = o[key];
    if (!Array.isArray(v) || v.length === 0) {
      this.problem(key, 'is missing or empty');
      return [];
    }
    v.forEach((item, i) => {
      if (!isObj(item)) this.problem(`${key}[${i}]`, 'is not an object');
    });
    return v.filter(isObj);
  }

  oneOf<T extends string>(o: Obj, key: string, where: string, allowed: readonly T[]): T {
    const v = this.text(o, key, where);
    if (v && !(allowed as readonly string[]).includes(v)) this.problem(`${where}.${key}`, `must be one of ${allowed.join(', ')}`);
    return v as T;
  }

  unique(seen: Set<string>, value: string, where: string): void {
    if (value && seen.has(value)) this.problem(where, `repeats "${value}"`);
    seen.add(value);
  }
}

function checkAnswers(raw: unknown): { version: string; rules: string[]; answers: KnowledgeAnswer[]; problems: string[] } {
  const c = new FileCheck('answers.json');
  if (!isObj(raw)) return { version: '', rules: [], answers: [], problems: ['answers.json: is not an object'] };
  const version = c.text(raw, 'version', '');
  const rules = c.texts(raw, 'rules', '');
  const ids = new Set<string>();
  const answers = c.list(raw, 'answers').map((a, i): KnowledgeAnswer => {
    const id = c.text(a, 'id', `answers[${i}]`);
    const where = id ? `answers[id=${id}]` : `answers[${i}]`;
    c.unique(ids, id, `${where}.id`);
    const status = c.oneOf(a, 'status', where, STATUSES);
    const answer = c.spoken(a, 'answer', where);
    const fallback = status === 'needs_confirmation' ? c.spoken(a, 'fallback_answer', where) : '';
    return {
      id,
      topic: c.text(a, 'topic', where),
      questions: c.texts(a, 'questions', where),
      spoken: status === 'needs_confirmation' ? fallback : answer,
      status,
      source: c.text(a, 'source', where),
    };
  });
  return { version, rules, answers, problems: c.problems };
}

function checkProducts(raw: unknown): { version: string; products: KnowledgeProduct[]; problems: string[] } {
  const c = new FileCheck('products.json');
  if (!isObj(raw)) return { version: '', products: [], problems: ['products.json: is not an object'] };
  const version = c.text(raw, 'version', '');
  const slugs = new Set<string>();
  const products = c.list(raw, 'products').map((p, i): KnowledgeProduct => {
    const slug = c.text(p, 'slug', `products[${i}]`);
    const where = slug ? `products[slug=${slug}]` : `products[${i}]`;
    c.unique(slugs, slug, `${where}.slug`);
    const url = c.text(p, 'url', where);
    if (url && !url.startsWith('https://')) c.problem(`${where}.url`, 'must start with https://');
    return {
      slug,
      name: c.text(p, 'name', where),
      type: c.oneOf(p, 'type', where, PRODUCT_TYPES),
      rxRequired: c.oneOf(p, 'rx_required', where, ['yes', 'no']) === 'yes',
      spokenLine: c.spoken(p, 'spoken_line', where),
      url,
    };
  });
  return { version, products, problems: c.problems };
}

function checkPlaybook(raw: unknown): { version: string; playbook: SalesPlaybook; problems: string[] } {
  const c = new FileCheck('sales-playbook.json');
  const empty: SalesPlaybook = { style: [], objections: [], closing: [], never: [], learning: '' };
  if (!isObj(raw)) return { version: '', playbook: empty, problems: ['sales-playbook.json: is not an object'] };
  const version = c.text(raw, 'version', '');
  const playbook: SalesPlaybook = {
    style: c.texts(raw, 'style', ''),
    objections: c.list(raw, 'objections').map((o, i) => ({
      leadSays: c.texts(o, 'lead_says', `objections[${i}]`),
      approach: c.text(o, 'approach', `objections[${i}]`),
      example: c.spoken(o, 'example', `objections[${i}]`),
    })),
    closing: c.list(raw, 'closing').map((o, i) => ({
      situation: c.text(o, 'situation', `closing[${i}]`),
      ask: c.spoken(o, 'ask', `closing[${i}]`),
    })),
    never: c.texts(raw, 'never', ''),
    learning: c.text(raw, 'learning', ''),
  };
  return { version, playbook, problems: c.problems };
}

/**
 * Checks the three files together: every problem in every file, not just the
 * first, so one run of the tests lists them all. `knowledge` is null when
 * there is any.
 */
export function checkKnowledge(files: KnowledgeFiles): { knowledge: Knowledge | null; problems: string[] } {
  const answers = checkAnswers(files.answers);
  const products = checkProducts(files.products);
  const playbook = checkPlaybook(files.playbook);
  const problems = [...answers.problems, ...products.problems, ...playbook.problems];

  const versions = [answers.version, products.version, playbook.version];
  if (versions.every(Boolean) && new Set(versions).size > 1) {
    problems.push(
      `the three files must share one version: answers.json ${answers.version}, products.json ${products.version}, sales-playbook.json ${playbook.version}`
    );
  }
  if (problems.length > 0) return { knowledge: null, problems };

  return {
    knowledge: {
      version: answers.version,
      rules: answers.rules,
      answers: answers.answers,
      products: products.products,
      playbook: playbook.playbook,
    },
    problems: [],
  };
}

export class KnowledgeError extends Error {
  constructor(readonly problems: string[]) {
    super(`Seri's knowledge files are broken: ${problems.join('; ')}`);
    this.name = 'KnowledgeError';
  }
}

let loaded: Knowledge | null = null;

/** Seri's knowledge, checked the first time and kept. Throws `KnowledgeError` naming every problem. */
export function loadKnowledge(): Knowledge {
  if (loaded) return loaded;
  const { knowledge, problems } = checkKnowledge({ answers: answersFile, products: productsFile, playbook: playbookFile });
  if (!knowledge) throw new KnowledgeError(problems);
  loaded = knowledge;
  return knowledge;
}
