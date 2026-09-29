/**
 * Settings the API refuses to start without in production. Each is fine to
 * leave loose locally, and a quiet hole on a public server.
 *
 * - **A weak JWT secret.** The placeholders in docker-compose.yml and
 *   .env.example are public; a session signed with one can be forged by anyone
 *   who has read this repo.
 * - **No EZ Texting webhook token - Jeel, 2026-09-29.** EZ Texting sends no
 *   signature, so the random last segment of the webhook path is the only
 *   check on who posts inbound texts (WEBHOOKS.md). Unset, the plain path is
 *   accepted - handy for local curl, but in production anyone who finds the
 *   URL can post fake replies: answer a lead's questions, or opt them out.
 *   Until this, .env.example only asked for it.
 *
 * Pure, so it is tested without starting anything; `api/index.ts` logs what it
 * returns and exits.
 */

const WEAK_SECRETS = new Set(['dev-secret', 'change-me', 'dev-secret-only-change-in-prod']);

/** Shorter than this is guessable enough to count as unset. */
const MIN_WEBHOOK_TOKEN_LENGTH = 16;

export function startupProblems(opts: {
  production: boolean;
  jwtSecret: string;
  webhookToken: string;
}): string[] {
  if (!opts.production) return [];
  const problems: string[] = [];
  if (WEAK_SECRETS.has(opts.jwtSecret) || opts.jwtSecret.length < 32) {
    problems.push('weak_jwt_secret');
  }
  if (opts.webhookToken.length < MIN_WEBHOOK_TOKEN_LENGTH) {
    problems.push('no_webhook_token');
  }
  return problems;
}
