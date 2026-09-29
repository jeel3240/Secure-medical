import { config } from '../config';
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
});
if (problems.length > 0) {
  for (const reason of problems) log.error('api.refused_start', { reason });
  process.exit(1);
}

const app = createApp({
  users: pgUserStore,
  jwtSecret: config.jwtSecret,
  secureCookies: isProduction,
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  log.info('api.started', { port });
});
