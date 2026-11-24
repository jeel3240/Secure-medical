import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { errText, log } from '../lib/log';

/** An error with a status and a stable machine-readable code the frontend can switch on. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** Express 4 does not catch rejected promises; this forwards them to the error handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * A request's path, fit for a log: the EZ Texting webhook's address holds its
 * secret token (`/api/webhooks/eztexting/<token>`, WEBHOOKS.md), and an error
 * before its own handling reached here with it (review H2, 2026-11-22).
 */
export function loggablePath(path: string): string {
  return path.replace(/^(\/api\/webhooks\/eztexting\/)[^/]+/, '$1:token');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' });
    return;
  }
  log.error('http.unhandled', { method: req.method, path: loggablePath(req.path), err: errText(err) });
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' });
};
