/**
 * The check every live check and the end-to-end script make, one copy - review
 * Q9, 2026-11-23. Each of the 24 scripts had its own, in two kinds: two
 * compared objects whatever the order of their keys, the rest by their JSON as
 * written, so whether a check passed could depend on the order a query or a
 * JSONB column happened to give the keys.
 *
 * `scripts/live-checks.sh` counts the lines that start `ok` and reads the last
 * line, "all checks passed" or "N check(s) FAILED" (`verdict`).
 */

let checks = 0;
let failures = 0;

/** JSON with every object's keys in order: two equal values read the same however their keys were built. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner
  );
}

/** One check: `actual` against `expected`, printed either way. */
export function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = stable(actual);
  const e = stable(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

/** How many checks have been made, and how many failed. */
export function checkCount(): number {
  return checks;
}

export function failureCount(): number {
  return failures;
}

/**
 * 'allowed', or the name of the constraint that refused what `run` wrote - else
 * the error's message, for a trigger or a rule with no name. How a check proves
 * the database says no to a row, and which of its rules did.
 */
export async function refusedBy(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'allowed';
  } catch (err) {
    const refused = err as { constraint?: string; message: string };
    return refused.constraint ?? refused.message;
  }
}

/** The last line `live-checks.sh` reads. */
export function verdict(): string {
  return failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`;
}
