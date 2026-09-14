import { config } from '../config';
import { pgUserStore } from '../db/users';
import { createApp } from './app';

const isProduction = process.env.NODE_ENV === 'production';

// The placeholder secrets from docker-compose.yml and .env.example are public.
// A token signed with one can be forged by anyone who has read this repo.
const WEAK_SECRETS = new Set(['dev-secret', 'change-me', 'dev-secret-only-change-in-prod']);
if (isProduction && (WEAK_SECRETS.has(config.jwtSecret) || config.jwtSecret.length < 32)) {
  console.error('JWT_SECRET is a placeholder or shorter than 32 characters. Refusing to start in production.');
  process.exit(1);
}

const app = createApp({
  users: pgUserStore,
  jwtSecret: config.jwtSecret,
  secureCookies: isProduction,
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
