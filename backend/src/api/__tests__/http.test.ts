/**
 * The app's last error handler (`api/http.ts`): what it logs of a request it
 * could not answer. Review H2, 2026-11-22 - the EZ Texting webhook's address
 * holds its secret token, and an error before its own handling logged it.
 */
import express from 'express';
import request from 'supertest';
import * as logModule from '../../lib/log';
import { asyncHandler, errorHandler, loggablePath } from '../http';

describe('what an unhandled error logs of the path', () => {
  it('never the EZ Texting webhook token - the route as the docs name it', async () => {
    const logged: Record<string, unknown>[] = [];
    const spy = jest.spyOn(logModule.log, 'error').mockImplementation((event, fields) => {
      logged.push({ event, ...fields });
    });
    const router = express.Router();
    router.post(
      '/eztexting/:token',
      asyncHandler(async () => {
        throw new Error('database down');
      })
    );
    const app = express();
    app.use('/api/webhooks', router);
    app.use(errorHandler);

    const res = await request(app).post('/api/webhooks/eztexting/s3cret-token-value').send({});
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(logged).toEqual([expect.objectContaining({ event: 'http.unhandled', path: '/api/webhooks/eztexting/:token' })]);
    expect(JSON.stringify(logged)).not.toContain('s3cret-token-value');
  });

  it('any other path as it is', () => {
    expect(loggablePath('/api/leads/12')).toBe('/api/leads/12');
    expect(loggablePath('/api/webhooks/twilio/auto/answer')).toBe('/api/webhooks/twilio/auto/answer');
    expect(loggablePath('/api/webhooks/eztexting/abc/extra')).toBe('/api/webhooks/eztexting/:token/extra');
  });
});
