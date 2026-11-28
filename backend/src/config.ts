import { readTwilioSettings } from './twilio-settings';

// REDIS_URL left this list on 2026-09-28: nothing reads it. Redis still runs in
// the compose files - ARCHITECTURE.md: it was planned for a job queue - but the code has
// never used it, and a required setting nothing reads only stops the app
// starting.
const required = ['DATABASE_URL', 'JWT_SECRET', 'EZT_USERNAME', 'EZT_PASSWORD', 'EZT_GROUP'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  ezt: {
    username: process.env.EZT_USERNAME!,
    password: process.env.EZT_PASSWORD!,
    // The account holds ~120k real contacts; every contacts query must be
    // scoped to this group.
    group: process.env.EZT_GROUP!,
    // Partner leads arrive as API. Contacts added by hand in the EZ Texting
    // dashboard arrive as WebInterface, so set this to WebInterface locally
    // to test with a contact you added yourself.
    source: process.env.EZT_SOURCE ?? 'API',
    // The switch that lets this server send texts - not a group: set to
    // anything, `sendMessage` sends; unset, it refuses every send. Its value is
    // never read beyond that (review Q12, 2026-11-23). The name is from when it
    // was to name a dev-test group of our own phones; it stays, as production's
    // .env sets it. Deliberately not in `required`: a new server sends nothing
    // until someone means it to.
    sendGroup: process.env.EZT_SEND_GROUP ?? '',
    // EZ Texting sends no signature header, even though a secret is passed when
    // registering the subscription, so the caller cannot be verified. A random
    // segment in the callback path is the fallback: only EZ Texting and we know
    // the URL. Unset means the webhook accepts any path, which is fine locally
    // but should always be set in production.
    webhookToken: process.env.EZT_WEBHOOK_TOKEN ?? '',
  },
  /** Browser calling: on, off, or set up only partly - twilio-settings.ts, TWILIO.md. */
  twilio: readTwilioSettings(process.env),
  /**
   * Seri, the AI agent on the automated call - AI-AGENT.md section 7. Not in
   * `required`: without a key the AI agent is off, whatever its switch says
   * (ai/settings.ts), and every call gets today's script.
   */
  openai: {
    apiKey: (process.env.OPENAI_API_KEY ?? '').trim(),
  },
};
