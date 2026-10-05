import { config } from '../config';
import { recordActivity } from '../db/activity';
import { pool } from '../db/pool';
import { pgUserStore } from '../db/users';
import { createApp } from './app';
import { log } from '../lib/log';
import { startupProblems } from './startup-checks';

const isProduction = process.env.NODE_ENV === 'production';

// Refuses to start on a production setting that would leave a hole -
// startup-checks.ts says which and why.
const problems = startupProblems({
  production: isProduction,
  jwtSecret: config.jwtSecret,
  webhookToken: config.ezt.webhookToken,
  twilio: config.twilio,
});
if (problems.length > 0) {
  const missing = config.twilio.status === 'incomplete' ? config.twilio.missing : undefined;
  for (const reason of problems) {
    log.error('api.refused_start', reason === 'twilio_incomplete' ? { reason, missing } : { reason });
  }
  process.exit(1);
}

// Locally a partial set only warns: calling stays off, everything else runs.
if (config.twilio.status === 'incomplete') {
  log.warn('calling.off', { reason: 'incomplete_settings', missing: config.twilio.missing });
}

const app = createApp({
  users: pgUserStore,
  jwtSecret: config.jwtSecret,
  secureCookies: isProduction,
  twilio: config.twilio.status === 'on' ? config.twilio.settings : null,
  activity: { record: (entry) => recordActivity(pool, entry) },
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  log.info('api.started', { port, calling: config.twilio.status });
});
