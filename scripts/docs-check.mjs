#!/usr/bin/env node
// The docs check - docs/DOCS.md made testable (doc-tickets D47, 2026-11-27).
//
//   node scripts/docs-check.mjs                 every doc
//   node scripts/docs-check.mjs docs/QUEUE.md   one or more docs
//   node scripts/docs-check.mjs --type area docs/NEW.md   a doc not yet in the index
//   node scripts/docs-check.mjs --strict        also: every doc is in the index
//   node scripts/docs-check.mjs --self-test     proves each rule catches its fault
//
// From backend/: `npm run docs:check`. Plain Node, no dependencies.
//
// What it checks, each a rule of docs/DOCS.md:
//   links     - every relative markdown link resolves
//   paths     - every backticked file path (docs, backend, frontend, scripts,
//               migrations) names a file that exists
//   numbers   - no phone number but the 555 range and the two Twilio numbers
//   names     - no word from a forbidden list (kept as SHA-256 hashes, so this
//               file does not itself hold the names)
//   sections  - a doc's `##` headings are its type's, in its type's order
//   asides    - no dated aside, "*(2026-..." or "As built", outside History and
//               Decisions in an area, reference, how-to or map doc
//   tickets   - a ticket's heading is `# <ID> · <Title>`, its id its file's;
//               tickets and trackers in folders that follow the standard have
//               the template's sections in order
//   index     - (--strict) every doc in docs/ is a row of docs/README.md's table

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- the standard, as data --------------------------------------------------

const TYPES = {
  map: { order: null, asides: true },
  architecture: {
    order: ['The parts', 'How they connect', 'Outside services', 'Decisions', 'History'],
    asides: true,
  },
  area: {
    order: ['How it works', 'Rules', 'Data', 'Code', 'Tests', 'Not done', 'Decisions', 'History'],
    asides: true,
  },
  // A reference's own tables have their own names; it ends with these two.
  reference: { order: null, tail: ['How to add an entry', 'History'], asides: true },
  // A how-to's steps may be several sections; it starts and ends the same way.
  'how-to': { order: null, head: ['Before you start'], tail: ['When it goes wrong', 'History'], asides: true },
  review: { order: null, asides: false },
  brief: { order: null, asides: false },
  standard: { order: null, asides: false },
};

const TICKET_SECTIONS = ['Build', 'Done when', 'Tests', 'Docs to update in the same commit', 'Not in this ticket', 'As built'];
const TRACKER_SECTIONS = ['The rules every ticket keeps', 'The tickets', 'The order', 'Waiting on', 'The decisions these tickets build on'];
// Finished phases' folders, kept as they were written (DOCS.md, "The phases").
const LEGACY_TICKET_DIRS = ['ai-agent-tickets'];
// Sections where dates and "As built" belong.
const DATED_SECTIONS = ['History', 'Decisions'];

// Names written as examples, not as files: the planning files DOCS.md forbids,
// `express.json()`, and the crawl's git-ignored `raw/` folder.
const NOT_FILES = new Set(['pending.md', 'plan.md', 'notes.md', 'TODO.md', 'express.json']);
const ALLOWED_NUMBERS = new Set(['4805308582', '4804708259']); // dev and production Twilio numbers
// SHA-256 of lower-cased words that must never appear (real people, real
// contacts, production's domain). Add one with:
//   node -e "console.log(require('crypto').createHash('sha256').update('word').digest('hex'))"
const FORBIDDEN = new Set([
  'ad9e1188a99fc2c58df38ce287cf261a1c0614d4269539c70c28ff9d839ee7b0',
  '0a348ac4d94f9da05a7866a206ed7936ad3f5504e659ac1c814e63adfcebff81',
  '8b9b28baf5f711d6490548a84f7fee1a591d9557891122fda745c6a9cde8a226',
  '98015e36c7c820e1835148dee477f30c74793003a620c0937eb235e859aa3361',
]);

// --- reading a doc ----------------------------------------------------------

function sections(lines) {
  const out = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && /^## /.test(line)) out.push({ title: line.slice(3).trim(), line: i + 1 });
  });
  return out;
}

function sectionAt(secs, lineNo) {
  let current = null;
  for (const s of secs) if (s.line <= lineNo) current = s.title;
  return current;
}

// --- the index --------------------------------------------------------------

function readIndex() {
  const p = join(ROOT, 'docs/README.md');
  if (!existsSync(p)) return { types: new Map(), listed: new Set() };
  const lines = readFileSync(p, 'utf8').split('\n');
  const types = new Map();
  const listed = new Set();
  let typeCol = -1;
  for (const line of lines) {
    if (!line.startsWith('|')) { typeCol = line.trim() === '' ? typeCol : -1; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] === 'Doc') { typeCol = cells.findIndex((c) => c === 'Type'); continue; }
    const m = cells[0] && cells[0].match(/`([^`]+)`/) || (cells[0] && cells[0].match(/\[([^\]]+)\]/));
    if (!m) continue;
    const name = m[1].replace(/^\.\.\//, '');
    const path = name.startsWith('CLAUDE') || name === 'README.md' && cells[0].includes('../') ? name : join('docs', name);
    listed.add(path.replace(/\/$/, ''));
    if (typeCol >= 0 && cells[typeCol]) types.set(path, cells[typeCol].toLowerCase());
  }
  return { types, listed };
}

// --- the checks -------------------------------------------------------------

// Every file in the repo, for a path written without its folder (`policy.ts`)
// or with only part of it (`evals/cases.json`).
let FILES = null;
function repoFiles() {
  if (FILES) return FILES;
  FILES = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'raw']);
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (skip.has(name)) continue;
      const rel = dir ? join(dir, name) : name;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else FILES.push(rel);
    }
  };
  walk('');
  return FILES;
}

function existsAnywhere(ref) {
  const tail = '/' + ref.replace(/^\.\//, '');
  return repoFiles().some((f) => ('/' + f).endsWith(tail));
}

function candidates(ref, docDir) {
  const clean = ref.replace(/^\.\//, '');
  const out = [join(docDir, clean), join(ROOT, clean), join(ROOT, 'docs', clean)];
  if (!clean.includes('/')) {
    if (/\.sql$/.test(clean)) out.push(join(ROOT, 'backend/src/db/migrations', clean));
    return out;
  }
  for (const base of ['backend', 'backend/src', 'frontend', 'frontend/src']) out.push(join(ROOT, base, clean));
  return out;
}

const PATH_RE = /`([A-Za-z0-9_.\-/]+\.(?:md|ts|tsx|js|mjs|sql|json|sh|yml|yaml|css))`/g;
const LINK_RE = /\]\(([^)\s]+)\)/g;
const PHONE_RES = [
  /(?<![\d\w])\+?1(\d{10})(?!\d)/g,                    // +16025550123, 16025550123
  /\((\d{3})\)\s?(\d{3})-(\d{4})/g,                    // (602) 555-0123
  /(?<![\d\w-])(\d{3})-(\d{3})-(\d{4})(?![\d-])/g,      // 602-555-0123
];

function phoneDigits(m, re) {
  return re === PHONE_RES[0] ? m[1] : m.slice(1, 4).join('');
}

function isAllowedPhone(ten) {
  // 555 as the area code or the exchange: fictional either way.
  return ten.slice(0, 3) === '555' || ten.slice(3, 6) === '555' || ALLOWED_NUMBERS.has(ten);
}

function hash(w) {
  return createHash('sha256').update(w.toLowerCase()).digest('hex');
}

export function checkDoc(file, text, opts = {}) {
  const problems = [];
  const say = (line, rule, msg) => problems.push({ file, line, rule, msg });
  const lines = text.split('\n');
  const secs = sections(lines);
  const docDir = dirname(join(ROOT, file));
  const type = opts.type;
  const def = type ? TYPES[type] : null;
  if (type && !def && type !== 'ticket' && type !== 'tracker') say(1, 'sections', `unknown type "${type}"`);

  let inFence = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^```/.test(line)) { inFence = !inFence; }
    // links
    for (const m of line.matchAll(LINK_RE)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target) || target.startsWith('<')) continue;
      if (!existsSync(resolve(docDir, target))) say(n, 'links', `link does not resolve: ${m[1]}`);
    }
    // paths
    if (!opts.skipPaths) {
      for (const m of line.matchAll(PATH_RE)) {
        const ref = m[1];
        if (/[<>*{}]|YYYY|\bNN\b/.test(ref) || ref.startsWith('.') && !ref.startsWith('./')) continue;
        if (NOT_FILES.has(ref) || ref.startsWith('raw/')) continue;
        if (!candidates(ref, docDir).some((c) => existsSync(c)) && !existsAnywhere(ref)) say(n, 'paths', `no such file: ${ref}`);
      }
    }
    // numbers
    for (const re of PHONE_RES) {
      for (const m of line.matchAll(re)) {
        const ten = phoneDigits(m, re);
        if (!isAllowedPhone(ten)) say(n, 'numbers', `a phone number outside the 555 range: ${m[0]}`);
      }
    }
    // names
    for (const w of line.match(/[A-Za-z][A-Za-z.\-]*[A-Za-z]/g) || []) {
      for (const part of [w, ...w.split(/[.\-]/)]) {
        if (FORBIDDEN.has(hash(part))) say(n, 'names', 'a forbidden name, number or domain (DOCS.md rules 5 and 8)');
      }
    }
    // asides
    if (def && def.asides && !inFence) {
      const where = sectionAt(secs, n);
      if (!DATED_SECTIONS.includes(where)) {
        if (/\*\((?:[^)]{0,40}?)\b20\d\d-\d\d-\d\d/.test(line)) say(n, 'asides', 'a dated aside in the body - move it to History');
        if (/\*{1,2}As built\b/.test(line)) say(n, 'asides', '"As built" in the body - move it to History');
      }
    }
  });

  // sections
  if (def) {
    const titles = secs.map((s) => s.title);
    if (def.order) {
      let last = -1;
      for (const s of secs) {
        const at = def.order.indexOf(s.title);
        if (at < 0) say(s.line, 'sections', `"## ${s.title}" is not a section of a ${type} doc (${def.order.join(', ')})`);
        else if (at < last) say(s.line, 'sections', `"## ${s.title}" is out of order`);
        else last = at;
      }
    }
    if (def.tail) {
      const tail = titles.slice(-def.tail.length);
      const present = def.tail.filter((t) => titles.includes(t));
      if (present.length && tail.slice(-present.length).join('|') !== present.join('|')) {
        say(secs.length ? secs[secs.length - 1].line : 1, 'sections', `a ${type} doc ends with: ${def.tail.join(', ')}`);
      }
    }
    if (def.head && titles.includes(def.head[0]) && titles[0] !== def.head[0]) {
      say(secs[0].line, 'sections', `a ${type} doc starts with "## ${def.head[0]}"`);
    }
    if (type !== 'review' && type !== 'brief' && type !== 'standard' && titles.length && !titles.includes('History')) {
      say(1, 'sections', 'no "## History" section');
    }
  }

  // tickets
  if (type === 'ticket') {
    const id = basename(file).match(/^([A-Z]\d\d[a-z]?)-/);
    const h1 = lines.find((l) => /^# /.test(l)) || '';
    const hm = h1.match(/^# ([A-Z]\d+[a-z]?) · .+/);
    if (!hm) say(1, 'tickets', 'the heading is not "# <ID> · <Title>"');
    else if (id && hm[1] !== id[1] && hm[1] !== id[1].replace(/^([A-Z])0(\d)/, '$1$2')) {
      say(1, 'tickets', `the heading's id ${hm[1]} is not the file's ${id[1]}`);
    }
    if (!opts.legacy) orderOf(secs, TICKET_SECTIONS, 'ticket', say);
  }
  if (type === 'tracker' && !opts.legacy) orderOf(secs, TRACKER_SECTIONS, 'tracker', say);
  return problems;
}

function orderOf(secs, wanted, what, say) {
  let last = -1;
  for (const s of secs) {
    const at = wanted.indexOf(s.title);
    if (at < 0) continue; // a ticket may add a section of its own (e.g. "Where it hooks in")
    if (at < last) say(s.line, 'sections', `"## ${s.title}" is out of order for a ${what}`);
    last = Math.max(last, at);
  }
}

// --- which files, which types -------------------------------------------------

function allDocs() {
  const out = ['CLAUDE.md', 'README.md'];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, name);
      if (statSync(join(ROOT, rel)).isDirectory()) {
        if (name !== 'templates') walk(rel);
      } else if (name.endsWith('.md')) out.push(rel);
    }
  };
  walk('docs');
  return out;
}

function typeOf(file, index, override) {
  if (override) return { type: override };
  const parts = file.split('/');
  const dir = parts.length > 2 ? parts[parts.length - 2] : '';
  if (dir.endsWith('-tickets')) {
    const legacy = LEGACY_TICKET_DIRS.includes(dir);
    return { type: basename(file) === 'README.md' ? 'tracker' : 'ticket', legacy };
  }
  if (/^docs\/REVIEW-\d{4}-\d\d-\d\d\.md$/.test(file)) return { type: 'review' };
  if (file === 'docs/DOCS.md') return { type: 'standard' };
  return { type: index.types.get(file) || null };
}

// --- self-test ----------------------------------------------------------------

function selfTest() {
  let failed = 0;
  const expect = (label, problems, rule) => {
    const ok = rule ? problems.some((p) => p.rule === rule) : problems.length === 0;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) { failed++; console.log('       ', JSON.stringify(problems)); }
  };
  const good = ['# Q', '', 'What it is, in `docs/DOCS.md`.', '', '## How it works', 'Today.', '',
    '## Decisions', '| D | Jeel | 2026-11-27 |', '', '## History', '- 2026-11-27 · written · why · D47'].join('\n');
  expect('a doc that meets the standard passes', checkDoc('docs/X.md', good, { type: 'area' }));
  expect('a broken link is caught', checkDoc('docs/X.md', good + '\n[x](NOPE.md)', { type: 'area' }), 'links');
  expect('a missing file is caught', checkDoc('docs/X.md', good + '\n`db/no-such-file.ts`', { type: 'area' }), 'paths');
  expect('a real-looking number is caught', checkDoc('docs/X.md', good + '\n+16021234567', { type: 'area' }), 'numbers');
  expect('a 555 number passes', checkDoc('docs/X.md', good + '\n+16025550123 and (480) 530-8582', { type: 'area' }));
  expect('a section out of order is caught',
    checkDoc('docs/X.md', ['## Rules', 'x', '## How it works', 'y', '## History', 'z'].join('\n'), { type: 'area' }), 'sections');
  expect('a section the type does not have is caught',
    checkDoc('docs/X.md', ['## Why', 'x', '## History', 'z'].join('\n'), { type: 'area' }), 'sections');
  expect('a dated aside in the body is caught',
    checkDoc('docs/X.md', ['## How it works', 'Text *(2026-09-28: changed)*.', '## History', 'z'].join('\n'), { type: 'area' }), 'asides');
  expect('a dated line in History passes',
    checkDoc('docs/X.md', ['## How it works', 'x', '## History', '- *(2026-09-28)* old'].join('\n'), { type: 'area' }));
  expect('a wrong ticket heading is caught', checkDoc('docs/x-tickets/X01-a.md', '# X02 · A', { type: 'ticket' }), 'tickets');
  expect('a ticket\'s sections out of order are caught',
    checkDoc('docs/x-tickets/X01-a.md', ['# X01 · A', '## Done when', 'x', '## Build', 'y'].join('\n'), { type: 'ticket' }), 'sections');
  FORBIDDEN.add(hash('zzforbiddenzz'));
  expect('a forbidden name is caught', checkDoc('docs/X.md', good + '\nzzforbiddenzz was here', { type: 'area' }), 'names');
  console.log(failed ? `\n${failed} self-test(s) FAILED` : '\nall self-tests passed');
  process.exit(failed ? 1 : 0);
}

// --- main ---------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const strict = args.includes('--strict');
  const ti = args.indexOf('--type');
  const override = ti >= 0 ? args[ti + 1] : null;
  const files = args.filter((a, i) => !a.startsWith('--') && !(ti >= 0 && i === ti + 1));
  const index = readIndex();
  const targets = files.length ? files.map((f) => relative(ROOT, resolve(process.cwd(), f))) : allDocs();
  const problems = [];
  for (const file of targets) {
    const { type, legacy } = typeOf(file, index, override);
    // A ticket names files it will create, so its paths are not checked.
    const skipPaths = type === 'ticket' || type === 'tracker';
    problems.push(...checkDoc(file, readFileSync(join(ROOT, file), 'utf8'), { type, legacy, skipPaths }));
    if (strict && !type) problems.push({ file, line: 1, rule: 'index', msg: 'not in docs/README.md\'s index with a Type' });
  }
  if (strict) {
    for (const f of allDocs()) {
      if (/-tickets\//.test(f) || f === 'CLAUDE.md' || f === 'README.md' || f === 'docs/README.md') continue;
      if (!index.listed.has(f)) problems.push({ file: f, line: 1, rule: 'index', msg: 'not listed in docs/README.md' });
    }
  }
  for (const p of problems) console.log(`${p.file}:${p.line}  [${p.rule}]  ${p.msg}`);
  const byRule = {};
  for (const p of problems) byRule[p.rule] = (byRule[p.rule] || 0) + 1;
  console.log(problems.length
    ? `\n${problems.length} problem(s) in ${new Set(problems.map((p) => p.file)).size} doc(s): ${JSON.stringify(byRule)}`
    : `\ndocs check passed - ${targets.length} doc(s)`);
  process.exit(problems.length ? 1 : 0);
}

main();
