import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';

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

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' });
    return;
  }
  console.error('unhandled error', req.method, req.path, err);
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' });
};
