import cookieParser from 'cookie-parser';
import express from 'express';
import { adminConfigRouter } from './admin/config';
import { adminDncRouter } from './admin/dnc';
import { adminOverviewRouter } from './admin/overview';
import { adminLeadsRouter } from './admin/leads';
import { authRouter } from './auth/routes';
import { callbacksRouter } from './callbacks';
import { queueRouter } from './leads';
import type { AppDeps } from './deps';
import { errorHandler } from './http';
import { usersRouter } from './users/routes';
import { webhooksRouter } from './webhooks';

/** Builds the Express app without listening, so tests can drive it directly. */
export function createApp(deps: AppDeps): express.Express {
  const app = express();

  // One proxy hop: Caddy in production, the Vite dev server locally. Needed so
  // req.ip is the browser's address, which the login rate limit keys on.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // API responses carry session state and one-time temporary passwords; no
  // browser or proxy should keep a copy.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter(deps));
  app.use('/api/users', usersRouter(deps));
  app.use('/api/leads', queueRouter(deps));
  app.use('/api/callbacks', callbacksRouter(deps));
  app.use('/api/admin/leads', adminLeadsRouter(deps));
  app.use('/api/admin/config', adminConfigRouter(deps));
  app.use('/api/admin/overview', adminOverviewRouter(deps));
  app.use('/api/admin/dnc', adminDncRouter(deps));

  // Unauthenticated: EZ Texting posts here. Under /api because that is the only
  // path Caddy forwards to the API.
  app.use('/api/webhooks', webhooksRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such endpoint.' });
  });

  app.use(errorHandler);
  return app;
}
