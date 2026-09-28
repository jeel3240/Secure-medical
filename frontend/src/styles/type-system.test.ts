import { describe, expect, it } from 'vitest';
// `?raw` hands over the file's text as written. It needs no Node APIs - this is
// a browser app with no Node types, so `node:fs` would fail `tsc` and with it
// `npm run build` - and it avoids `new URL('./x.css', import.meta.url)`, which
// Vite rewrites into an asset reference: an earlier version of this test read
// the wrong thing that way and passed four checks over an empty stylesheet.
// Hence the "really loaded" assertions below.
import tokens from './tokens.css?raw';
import globalRaw from './global.css?raw';

/**
 * Keeps the type system in tokens.css the only type system.
 *
 * The app once used ten font sizes - three of them fractions like 12.48px, from
 * `0.85em` nested inside other text - and 12, 13 and 14px all at once, one
 * pixel apart. Nothing caught it because nothing checked. These tests read the
 * stylesheets and fail on any size, weight or caption style the tokens do not
 * name, so the next "this looks about right" is a red build rather than a
 * slow drift.
 */

const global = globalRaw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selector { body }` block, innermost first - media queries included. */
const rules = [...global.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector.trim().replace(/\s+/g, ' '),
  body,
}));

const declared = (body: string, prop: string) =>
  [...body.matchAll(new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());

describe('the stylesheets under test', () => {
  // Guards against the checks below passing vacuously on a file that did not
  // load: every "no strays" assertion is trivially true over zero rules.
  it('really loaded', () => {
    expect(tokens).toContain(':root');
    expect(global).toContain('font-size');
    expect(rules.length).toBeGreaterThan(100);
  });
});

const SIZES = ['--text-small', '--text-body', '--text-title', '--text-heading', '--text-display'];
const WEIGHTS = ['--weight-regular', '--weight-semibold', '--weight-bold'];

describe('the type tokens', () => {
  it('define exactly five sizes', () => {
    const sizes = [...tokens.matchAll(/(--text-[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(sizes).toEqual(SIZES);
  });

  it('keep every size at least 2px from the next, so a size change always means something', () => {
    const px = SIZES.map((name) => Number(tokens.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1]));
    expect(px).toEqual([...px].sort((a, b) => a - b));
    px.slice(1).forEach((size, i) => expect(size - px[i]).toBeGreaterThanOrEqual(2));
  });

  it('define exactly three weights', () => {
    const weights = [...tokens.matchAll(/(--weight-[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(weights).toEqual(WEIGHTS);
  });
});

describe('every rule in global.css', () => {
  const allowedSize = new Set([...SIZES.map((t) => `var(${t})`), 'inherit']);
  const allowedWeight = new Set([...WEIGHTS.map((t) => `var(${t})`), 'inherit']);

  it('uses one of the five sizes - no px, em or rem', () => {
    const strays = rules.flatMap(({ selector, body }) =>
      declared(body, 'font-size')
        .filter((value) => !allowedSize.has(value))
        .map((value) => `${selector}: ${value}`)
    );
    expect(strays).toEqual([]);
  });

  it('uses one of the three weights', () => {
    const strays = rules.flatMap(({ selector, body }) =>
      declared(body, 'font-weight')
        .filter((value) => !allowedWeight.has(value))
        .map((value) => `${selector}: ${value}`)
    );
    expect(strays).toEqual([]);
  });

  it('styles every uppercase caption as the label role, identically', () => {
    // Uppercase captions had two letter-spacings and two weights between them.
    const wrong = rules
      .filter(({ body }) => declared(body, 'text-transform').includes('uppercase'))
      .filter(
        ({ body }) =>
          !declared(body, 'font-size').includes('var(--text-small)') ||
          !declared(body, 'font-weight').includes('var(--weight-semibold)') ||
          !declared(body, 'letter-spacing').includes('var(--tracking-label)')
      )
      .map(({ selector }) => selector);
    expect(wrong).toEqual([]);
  });

  it('declares no property twice in one rule', () => {
    const doubled = rules.flatMap(({ selector, body }) => {
      const props = [...body.matchAll(/(?<![-\w])([a-z-]+)\s*:/g)].map((m) => m[1]);
      return props.filter((p, i) => props.indexOf(p) !== i).map((p) => `${selector}: ${p}`);
    });
    expect(doubled).toEqual([]);
  });

  it('defines each selector once, so no rule silently overrides an earlier one', () => {
    // A second `.avatar` further down, written for the workspace, restyled the
    // app bar's avatar on every page and nothing noticed. Within a media query
    // a repeat is the point, so only top-level rules are counted.
    const topLevel: string[] = [];
    let depth = 0;
    let buffer = '';
    for (const char of global) {
      if (char === '{') {
        if (depth === 0 && !buffer.trim().startsWith('@')) topLevel.push(buffer.trim().replace(/\s+/g, ' '));
        depth += 1;
        buffer = '';
      } else if (char === '}') {
        depth -= 1;
        buffer = '';
      } else {
        buffer += char;
      }
    }
    const repeated = topLevel.filter((selector, i) => topLevel.indexOf(selector) !== i);
    expect(repeated).toEqual([]);
  });

  it('pins headings to one weight, so a rule that forgets its weight cannot fall back to the browser bold', () => {
    const base = rules.find(({ selector }) => /^h1, ?h2, ?h3/.test(selector));
    expect(base && declared(base.body, 'font-weight')).toEqual(['var(--weight-semibold)']);
  });
});

describe('every token global.css uses', () => {
  it('is defined somewhere - an unknown var() is silently dropped by the browser', () => {
    // --color-surface-alt was used in seven places and defined in none, so
    // queue row hover, the locked-row shading, the callback chips' hover, the
    // Config message boxes and the Overview funnel track never rendered at all,
    // and nothing said so.
    const defined = new Set(
      [...tokens.matchAll(/(--[\w-]+)\s*:/g), ...global.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
    );
    const used = [...new Set([...global.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];

    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
