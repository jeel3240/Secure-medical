/**
 * The one-agent lock on writes: a lead is yours to act on only once you have
 * picked it - Jeel, 2026-09-28.
 *
 * Before this, claiming was the only place the lock was enforced. Notes,
 * callbacks, agent SMS, dispositions - DNC included - and marking a reply read
 * were accepted from anyone signed in, on any lead. The database layer is
 * mocked; what is under test is that each route asks who holds the lead, and
 * refuses before it writes anything.
 */
import request from 'supertest';
import { buildApp, seedUser, signIn } from './helpers';
import type { Holding } from '../../db/holder';

const holding = jest.fn<Promise<Holding>, [number, number]>();
jest.mock('../../db/holder', () => ({ holding: (...a: [number, number]) => holding(...a) }));

// Every write the guard sits in front of. None of these may be reached when
// the caller does not hold the lead.
const addNote = jest.fn();
const createCallback = jest.fn();
const sendAgentSms = jest.fn();
const setDisposition = jest.fn();
const markLeadRead = jest.fn();
const getLeadDetail = jest.fn();
jest.mock('../../db/notes', () => ({ addNote: (...a: unknown[]) => addNote(...a) }));
jest.mock('../../db/callbacks', () => ({ createCallback: (...a: unknown[]) => createCallback(...a) }));
jest.mock('../../db/agent-sms', () => ({
  AGENT_SMS_LIMIT: 160,
  sendAgentSms: (...a: unknown[]) => sendAgentSms(...a),
}));
jest.mock('../../db/dispositions', () => ({ setDisposition: (...a: unknown[]) => setDisposition(...a) }));
jest.mock('../../db/read-flag', () => ({ markLeadRead: (...a: unknown[]) => markLeadRead(...a) }));
jest.mock('../../db/lead-detail', () => ({ getLeadDetail: (...a: unknown[]) => getLeadDetail(...a) }));

const PASSWORD = 'correct-horse-battery';
const IN_AN_HOUR = new Date(Date.now() + 3600_000).toISOString();

const WRITES = [
  { name: 'adding a note', path: '/api/leads/7/notes', body: { body: 'Left a voicemail' }, write: addNote },
  { name: 'booking a callback', path: '/api/leads/7/callbacks', body: { scheduledAt: IN_AN_HOUR }, write: createCallback },
  { name: 'sending an SMS', path: '/api/leads/7/messages', body: { body: 'Hi' }, write: sendAgentSms },
  { name: 'setting a disposition', path: '/api/leads/7/dispositions', body: { value: 'interested' }, write: setDisposition },
  { name: 'marking the reply read', path: '/api/leads/7/read', body: {}, write: markLeadRead },
] as const;

beforeEach(() => {
  [holding, addNote, createCallback, sendAgentSms, setDisposition, markLeadRead, getLeadDetail].forEach((m) =>
    m.mockReset()
  );
});

async function signedIn() {
  const { app, users } = await buildApp();
  const maya = await seedUser(users, { email: 'maya@example.com', name: 'Maya', password: PASSWORD });
  return { app, agent: await signIn(app, 'maya@example.com', PASSWORD), mayaId: maya.id };
}

describe.each(WRITES)('$name', ({ path, body, write }) => {
  it('is refused on a lead nobody has picked, and writes nothing', async () => {
    const { agent } = await signedIn();
    holding.mockResolvedValue({ status: 'free' });

    const res = await agent.post(path).send(body);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_picked', message: 'Pick this lead before acting on it.' });
    expect(write).not.toHaveBeenCalled();
  });

  it('is refused on a lead someone else holds, naming them, and writes nothing', async () => {
    const { agent } = await signedIn();
    holding.mockResolvedValue({ status: 'other', holder: 'karm' });

    const res = await agent.post(path).send(body);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_claimed', message: 'karm is working this lead.' });
    expect(write).not.toHaveBeenCalled();
  });

  it('is a 404 for a lead that does not exist', async () => {
    const { agent } = await signedIn();
    holding.mockResolvedValue({ status: 'not_found' });

    expect((await agent.post(path).send(body)).status).toBe(404);
    expect(write).not.toHaveBeenCalled();
  });

  it('asks about this lead and this caller', async () => {
    const { agent, mayaId } = await signedIn();
    holding.mockResolvedValue({ status: 'free' });

    await agent.post(path).send(body);

    expect(holding).toHaveBeenCalledWith(7, mayaId);
  });
});

describe('the order of the checks', () => {
  it('refuses before validating, so a caller who may not act learns nothing from their request', async () => {
    const { agent } = await signedIn();
    holding.mockResolvedValue({ status: 'free' });

    // An invalid disposition would be a 400 - but only for the holder.
    const res = await agent.post('/api/leads/7/dispositions').send({ value: 'not-a-disposition' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_picked');
  });

  it('still needs a session first', async () => {
    const { app } = await signedIn();
    const res = await request(app).post('/api/leads/7/notes').send({ body: 'hi' });

    expect(res.status).toBe(401);
    expect(holding).not.toHaveBeenCalled();
  });
});

describe('reading a lead', () => {
  it('needs no claim - the workspace shows a lead before it is picked', async () => {
    const { agent } = await signedIn();
    holding.mockResolvedValue({ status: 'other', holder: 'karm' });
    getLeadDetail.mockResolvedValue({ id: 7 });

    const res = await agent.get('/api/leads/7');

    expect(res.status).toBe(200);
    expect(holding).not.toHaveBeenCalled();
  });
});
