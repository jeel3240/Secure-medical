/**
 * Structured logging: one JSON object per line on stdout.
 *
 * Phase 3 task 26. `LOGGING.md` is the spec. Docker collects stdout and
 * `docker-compose.prod.yml` ships it off the instance, so the only thing the
 * code owed was the shape.
 *
 *   log.info('poll.tick', { fetched: 2, inserted: 1, ms: 336 })
 *   -> {"ts":"2026-09-28T10:04:11.204Z","level":"info","event":"poll.tick",
 *       "svc":"worker","fetched":2,"inserted":1,"ms":336}
 *
 * **`event` is the field everything groups by.** Dotted, lower case, and from
 * the list in `LOGGING.md` - a new one belongs in that doc as well as here, or
 * whoever is querying the logs will never know to look for it.
 *
 * **Never log a phone number, a message body, a name, a password, a token or
 * the EZ Texting credentials.** Logs leave the machine and are kept for months;
 * a `leadId` is enough to find the row, and the row has the rest. That is the
 * one rule in `LOGGING.md` that is not a preference, so `redact()` below
 * enforces it rather than trusting every call site to remember - six lines in
 * `webhooks.ts` were logging raw phone numbers before this task.
 */

export type Level = 'info' | 'warn' | 'error';

/** A log line's fields. Values must be JSON-serialisable. */
export type Fields = Record<string, unknown>;

/**
 * Which process wrote the line, so `api` and `worker` can be told apart in one
 * stream.
 *
 * Derived from the entry point rather than an env var: the worker always knows
 * it is the worker, and a `SERVICE_NAME` that has to be set in every compose
 * file is one that will be missing from one of them. It was, on the first run -
 * every worker line said `svc: "api"`, which is the one thing this field exists
 * to prevent. `SERVICE_NAME` still wins when set, for anything started another
 * way.
 */
const SERVICE =
  process.env.SERVICE_NAME ??
  (process.argv.some((arg) => /worker/.test(arg)) ? 'worker' : 'api');

/**
 * Field names that must never reach a log, whatever a call site passes.
 *
 * Matched case-insensitively on the whole key, plus a few suffix rules below,
 * so `phone`, `fromNumber`, `toNumber`, `body`, `firstName` and `password` are
 * all caught. The value is replaced with `[redacted]` rather than dropped, so a
 * line still shows that a field was there - silently vanishing fields are worse
 * to debug than obviously hidden ones.
 */
const FORBIDDEN = new Set([
  'phone',
  'phones',
  'fromnumber',
  'tonumber',
  'tonumbers',
  'number',
  'body',
  'message',
  'text',
  'name',
  'firstname',
  'lastname',
  'email',
  'password',
  'passwordhash',
  'token',
  'secret',
  'authorization',
  'eztusername',
  'eztpassword',
]);

/**
 * Names that are always allowed, whatever the suffix rules below would say.
 *
 * `key` is the settings key an SMS was rendered from - `question_1`,
 * `message_clarify_2` - and it is the field the sms.* events group by. The
 * `endsWith('key')` rule below redacted it, which cost nothing in safety and
 * most of the value of those lines. Found by reading real output rather than
 * the code.
 */
const ALLOWED = new Set(['key', 'eventkey', 'settingkey']);

/** Catches `apiKey`, `accessToken`, `jwtSecret` and the like without listing each. */
function looksSensitive(name: string): boolean {
  const k = name.toLowerCase();
  if (ALLOWED.has(k)) return false;
  if (FORBIDDEN.has(k)) return true;
  return (
    k.endsWith('password') ||
    k.endsWith('secret') ||
    k.endsWith('token') ||
    k.endsWith('key') ||
    k.endsWith('phone')
  );
}

/**
 * Strips forbidden fields, one level deep into plain objects.
 *
 * Deep enough for real lines - `{ lead: { id, phone } }` is caught - without
 * walking arbitrary structures on every log call. An `Error` is reduced to its
 * message, because a stack can hold a message body in an interpolated string.
 */
export function redact(fields: Fields): Fields {
  const out: Fields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (looksSensitive(key)) {
      out[key] = '[redacted]';
      continue;
    }

    if (value instanceof Error) {
      out[key] = value.message;
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested: Fields = {};
      for (const [k, v] of Object.entries(value as Fields)) {
        nested[k] = looksSensitive(k) ? '[redacted]' : v;
      }
      out[key] = nested;
      continue;
    }

    out[key] = value;
  }

  return out;
}

/**
 * Writes one line. Undefined values are dropped so optional fields do not
 * clutter every line with nulls.
 */
function write(level: Level, event: string, fields: Fields = {}): void {
  const line: Fields = {
    ts: new Date().toISOString(),
    level,
    event,
    svc: SERVICE,
  };

  for (const [key, value] of Object.entries(redact(fields))) {
    if (value !== undefined) line[key] = value;
  }

  // console.error for warn and error so they reach stderr: a container's
  // stderr is what most collectors alert on, and `level=error` is meant to be
  // the cheapest useful alarm there is.
  const out = level === 'info' ? console.log : console.error;
  out(JSON.stringify(line));
}

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};

/**
 * The message from whatever was thrown, for an `err` field.
 *
 * Axios failures carry the useful part in `response.data`, which is what the
 * old `JSON.stringify(detail)` lines were reaching for; anything else falls
 * back to the message. Never the stack: it can hold interpolated user data,
 * and `LOGGING.md`'s rule does not bend for convenience.
 */
export function errText(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data !== undefined) {
    return typeof data === 'string' ? data : JSON.stringify(data);
  }
  return err instanceof Error ? err.message : String(err);
}
