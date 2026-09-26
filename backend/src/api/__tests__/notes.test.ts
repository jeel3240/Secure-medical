/**
 * `POST /api/leads/:id/notes`. The database layer is mocked; the route
 * contract is what is under test.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { AddNoteResult } from '../../db/notes';

const addNote = jest.fn<Promise<AddNoteResult>, [number, number, string]>();
jest.mock('../../db/notes', () => ({
  addNote: (...a: [number, number, string]) => addNote(...a),
}));

const PASSWORD = 'correct-horse-battery';

const A_NOTE = {
  id: 1,
  leadId: 7,
  author: 'Maya',
  body: 'Left a voicemail',
  createdAt: '2026-09-26T10:00:00.000Z',
};

beforeEach(() => {
  addNote.mockReset();
  addNote.mockResolvedValue({ ok: true, note: A_NOTE });
});

async function setup() {
  const { app, users } = await buildApp();
  await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  const agent = await signIn(app, 'maya@example.com', PASSWORD);
  return { app, agent };
}

describe('adding a note', () => {
  it('turns away anyone not signed in', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/leads/7/notes').send({ body: 'hello' });
    expect(res.status).toBe(401);
    expect(addNote).not.toHaveBeenCalled();
  });

  it('writes the note and returns it', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/notes').send({ body: 'Left a voicemail' });

    expect(res.status).toBe(201);
    expect(res.body.note).toEqual(A_NOTE);
    // The author comes from the session, never the payload.
    expect(addNote).toHaveBeenCalledWith(7, expect.any(Number), 'Left a voicemail');
  });

  it('ignores an author sent in the body', async () => {
    const { agent } = await setup();
    await agent.post('/api/leads/7/notes').send({ body: 'hi', agentId: 999, author: 'Someone' });

    const [, agentId] = addNote.mock.calls[0];
    expect(agentId).not.toBe(999);
  });

  it('trims surrounding whitespace', async () => {
    const { agent } = await setup();
    await agent.post('/api/leads/7/notes').send({ body: '  spoke to them  ' });
    expect(addNote).toHaveBeenCalledWith(7, expect.any(Number), 'spoke to them');
  });

  it.each([
    ['missing', {}],
    ['empty', { body: '' }],
    ['only whitespace', { body: '   ' }],
    ['not a string', { body: 42 }],
  ])('rejects a body that is %s', async (_label, payload) => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/notes').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
    expect(addNote).not.toHaveBeenCalled();
  });

  it('rejects a body beyond the length cap', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/notes').send({ body: 'x'.repeat(5001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('body_too_long');
    expect(addNote).not.toHaveBeenCalled();
  });

  it('accepts a body at the cap', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/leads/7/notes').send({ body: 'x'.repeat(5000) });
    expect(res.status).toBe(201);
  });

  it('answers 404 for a lead that does not exist', async () => {
    const { agent } = await setup();
    addNote.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await agent.post('/api/leads/999/notes').send({ body: 'hi' });
    expect(res.status).toBe(404);
  });

  it('rejects a lead id that is not a positive whole number', async () => {
    const { agent } = await setup();
    for (const bad of ['abc', '0', '-1']) {
      expect((await agent.post(`/api/leads/${bad}/notes`).send({ body: 'hi' })).status).toBe(400);
    }
    expect(addNote).not.toHaveBeenCalled();
  });
});
