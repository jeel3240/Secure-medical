/**
 * Proves the activity log against a real Postgres - docs/AUDIT.md.
 *
 * The company keeps data as proof. Whether each action leaves its record - in
 * the same statement or transaction as the action - and whether the log can be
 * altered afterwards are properties of the SQL and the database's triggers,
 * which the jest tests mock away. This runs them for real.
 *
 * It writes rows, so it refuses to run against a database that holds any:
 *
 *   docker compose exec postgres psql -U app -d postgres -c 'CREATE DATABASE activity_check'
 *   DATABASE_URL=postgres://app:app@localhost:5433/activity_check node scripts/migrate.js
 *   DATABASE_URL=postgres://app:app@localhost:5433/activity_check JWT_SECRET=x \
 *     EZT_USERNAME=x EZT_PASSWORD=x EZT_GROUP=x npx ts-node --transpile-only scripts/activity-live-check.ts
 */
import { pool } from '../src/db/pool';
import { archiveWebhook, recordActivity } from '../src/db/activity';
import { createCallback, updateCallback } from '../src/db/callbacks';
import { finishCall, startCall } from '../src/db/calls';
import { claimLead, releaseLead } from '../src/db/claims';
import { setDisposition } from '../src/db/dispositions';
import { blockNumber, DNC_REASONS, releaseNumber } from '../src/db/dnc';
import { addNote } from '../src/db/notes';
import { markLeadRead } from '../src/db/read-flag';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

async function refuseIfNotEmpty(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM leads)::int AS leads, (SELECT count(*) FROM users)::int AS users`
  );
  if (rows[0].leads > 0 || rows[0].users > 0) {
    console.error('Refusing to run: this database already holds rows. Use a scratch database.');
    process.exit(1);
  }
}

async function makeUser(name: string, role = 'agent', active = true): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, is_active) VALUES ($1, 'x', $2, $3, $4) RETURNING id`,
    [`${name.toLowerCase()}@example.com`, name, role, active]
  );
  return rows[0].id;
}

let nextPhone = 801;
async function makeLead(): Promise<{ id: number; phone: string }> {
  const phone = `+15550000${nextPhone++}`;
  const { rows } = await pool.query(`INSERT INTO leads (phone, first_name) VALUES ($1, 'Lead') RETURNING id`, [phone]);
  await pool.query(
    `INSERT INTO conversations (lead_id, status, step, q1, q2, q3, score, tier) VALUES ($1, 'completed', 3, '1', '1', '1', 90, 'HOT')`,
    [rows[0].id]
  );
  return { id: rows[0].id, phone };
}

interface Row {
  action: string;
  actor: number | null;
  subject: number | null;
  detail: Record<string, unknown>;
}

/** What the log holds for a lead, oldest first. */
async function logFor(leadId: number): Promise<Row[]> {
  const { rows } = await pool.query(
    `SELECT action, actor_id AS actor, subject_user_id AS subject, detail
     FROM activity_log WHERE lead_id = $1 ORDER BY id`,
    [leadId]
  );
  return rows;
}
const actions = (rows: Row[]) => rows.map((r) => r.action);

async function refuses(sql: string): Promise<string> {
  try {
    await pool.query(sql);
    return 'allowed';
  } catch (err) {
    return (err as Error).message;
  }
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();
  const maya = await makeUser('Maya');
  const sam = await makeUser('Sam');
  const boss = await makeUser('Boss', 'superadmin');
  const gone = await makeUser('Gone', 'agent', false);

  console.log('\nwho held a lead, and when');
  {
    const lead = await makeLead();
    await claimLead(lead.id, maya);
    await claimLead(lead.id, maya); // Resume: not a new pick-up.
    check('picking up is recorded once, resuming is not', (await logFor(lead.id)).map((r) => [r.action, r.actor]), [
      ['lead.picked_up', maya],
    ]);

    const held = (await pool.query(`SELECT assigned_at FROM leads WHERE id = $1`, [lead.id])).rows[0].assigned_at;
    await releaseLead(lead.id, maya, false);
    const released = (await logFor(lead.id))[1];
    check('releasing is recorded, with who held it', [released.action, released.actor, released.subject], ['lead.released', maya, maya]);
    check('and since when - what the release itself erases', new Date(released.detail.heldSince as string).getTime(), held.getTime());
    check('not forced', released.detail.forced, false);

    await releaseLead(lead.id, maya, false);
    check('releasing a lead nobody holds records nothing', (await logFor(lead.id)).length, 2);

    await claimLead(lead.id, sam);
    await releaseLead(lead.id, boss, true);
    const forced = (await logFor(lead.id)).at(-1)!;
    check('a superadmin releasing another agent is recorded as forced, against that agent', [forced.actor, forced.subject, forced.detail.forced], [boss, sam, true]);

    await pool.query(`UPDATE leads SET assigned_to = $2, assigned_at = now() WHERE id = $1`, [lead.id, gone]);
    await claimLead(lead.id, maya);
    check('taking over from a deactivated agent says who from', (await logFor(lead.id)).at(-1)!.detail, { tookOverFrom: gone });

    const refused = await claimLead(lead.id, sam);
    check('a refused pick-up records nothing', [refused.ok, (await logFor(lead.id)).filter((r) => r.actor === sam && r.action === 'lead.picked_up').length], [false, 1]);
  }

  console.log('\na callback that is moved');
  {
    const lead = await makeLead();
    const first = new Date(Date.now() + 3600_000);
    const second = new Date(Date.now() + 2 * 86400_000);
    const made = await createCallback(lead.id, maya, first, boss);
    const id = made.ok ? made.callback.id : 0;

    const booked = (await logFor(lead.id))[0];
    check('booking is recorded: who booked it, and for whom', [booked.action, booked.actor, booked.subject], ['callback.booked', boss, maya]);

    await updateCallback(id, maya, false, { scheduledAt: second });
    const moved = (await logFor(lead.id))[1];
    check('rescheduling keeps the original time', [moved.action, new Date(moved.detail.from as string).getTime(), new Date(moved.detail.to as string).getTime()], [
      'callback.rescheduled',
      first.getTime(),
      second.getTime(),
    ]);

    await updateCallback(id, maya, false, { scheduledAt: second });
    check('moving it to the time it already has records nothing', (await logFor(lead.id)).length, 2);

    await updateCallback(id, maya, false, { done: true });
    await updateCallback(id, maya, false, { done: true });
    check('done is recorded once', actions(await logFor(lead.id)).slice(2), ['callback.done']);

    await updateCallback(id, maya, false, { done: false });
    const reopened = (await logFor(lead.id)).at(-1)!;
    check('reopening keeps when it had been done', [reopened.action, typeof reopened.detail.wasDoneAt], ['callback.reopened', 'string']);

    await updateCallback(id, boss, true, { scheduledAt: first, done: true });
    check('a move and a done in one save are two records', actions(await logFor(lead.id)).slice(-2), ['callback.rescheduled', 'callback.done']);
  }

  console.log('\nnotes and reading a reply');
  {
    const lead = await makeLead();
    const note = await addNote(lead.id, maya, 'Left a voicemail.');
    await pool.query(`UPDATE leads SET has_unread_inbound = true WHERE id = $1`, [lead.id]);
    await markLeadRead(lead.id, maya);
    await markLeadRead(lead.id, maya);
    const rows = await logFor(lead.id);
    check('a note is recorded, pointing at the note', [rows[0].action, rows[0].detail], ['note.added', { noteId: note.ok ? note.note.id : 0 }]);
    check('reading a reply is recorded once, by whom', rows.slice(1).map((r) => [r.action, r.actor]), [['reply.read', maya]]);
  }

  console.log('\nan outcome, and everything it does');
  {
    const lead = await makeLead();
    await claimLead(lead.id, maya);
    await createCallback(lead.id, maya, new Date(Date.now() + 3600_000));
    await setDisposition(lead.id, maya, 'closed');
    const rows = (await logFor(lead.id)).slice(2);
    check('the outcome, the release it causes and the callback it finishes are all recorded', actions(rows), [
      'outcome.set',
      'lead.released',
      'callback.done',
    ]);
    check('the release says it was the outcome', rows[1].detail.because, 'outcome');
    check('and so does the finished callback', rows[2].detail.because, 'outcome');
  }

  console.log('\nthe do-not-call list');
  {
    const lead = await makeLead();
    await blockNumber(pool, lead.phone, DNC_REASONS.smsStop);
    await releaseNumber(pool, lead.phone);
    await blockNumber(pool, lead.phone, DNC_REASONS.agentDisposition, maya);
    const rows = await logFor(lead.id);
    check('block, release and block again are three records', actions(rows), ['dnc.blocked', 'dnc.released', 'dnc.blocked']);
    check('the first block has no earlier one', 'previous' in rows[0].detail, false);
    const previous = rows[2].detail.previous as Record<string, unknown>;
    check('re-blocking keeps what the row said before it was overwritten', [previous.reason, typeof previous.releasedAt, previous.releaseReason], [
      'sms_stop',
      'string',
      'sms_start',
    ]);
    check('an agent blocking is recorded as that agent', rows[2].actor, maya);

    await blockNumber(pool, '+15559990000', DNC_REASONS.eztOptOut);
    const { rows: orphan } = await pool.query(`SELECT lead_id, detail->>'phone' AS phone FROM activity_log WHERE detail->>'phone' = '+15559990000'`);
    check('a number with no lead is still recorded, by its phone', orphan, [{ lead_id: null, phone: '+15559990000' }]);
  }

  console.log('\ncalls');
  {
    const lead = await makeLead();
    await startCall({ callSid: 'CA-none', leadId: lead.id, agentId: maya });
    await claimLead(lead.id, maya);
    await startCall({ callSid: 'CA-ok', leadId: lead.id, agentId: maya });
    await startCall({ callSid: 'CA-ok', leadId: lead.id, agentId: maya });
    await finishCall({ callSid: 'CA-ok', outcome: 'answered', durationSec: 42 });
    await finishCall({ callSid: 'CA-ok', outcome: 'failed', durationSec: 0 });
    const rows = await logFor(lead.id);
    check('a refused call, a started call and its end are recorded, each once', actions(rows), [
      'call.refused',
      'lead.picked_up',
      'call.started',
      'call.ended',
    ]);
    check('the refusal says why - its only record, there being no call row', rows[0].detail.reason, 'not_holder');
    check('the end is Twilio’s report, against the agent who called', [rows[3].actor, rows[3].subject, rows[3].detail.outcome, rows[3].detail.durationSec], [null, maya, 'answered', 42]);
  }

  console.log('\nthe log cannot be altered');
  {
    check('an edit is refused', await refuses(`UPDATE activity_log SET action = 'x'`), 'activity_log is add-only: rows cannot be changed or deleted');
    check('a delete is refused', await refuses(`DELETE FROM activity_log`), 'activity_log is add-only: rows cannot be changed or deleted');
    const before = (await pool.query(`SELECT count(*)::int AS n FROM activity_log`)).rows[0].n;
    await recordActivity(pool, { action: 'auth.signed_in', actorId: maya });
    check('adding still works', (await pool.query(`SELECT count(*)::int AS n FROM activity_log`)).rows[0].n, before + 1);
  }

  console.log('\nthe raw webhook archive');
  {
    const payload = { type: 'inbound_text.received', fromNumber: '15550000801', message: 'STOP' };
    await archiveWebhook(pool, { source: 'eztexting', path: '/api/webhooks/eztexting', payload });
    const { rows } = await pool.query(`SELECT source, path, payload FROM webhook_events`);
    check('keeps the request as it arrived', rows, [{ source: 'eztexting', path: '/api/webhooks/eztexting', payload }]);
    check('and cannot be edited', await refuses(`UPDATE webhook_events SET payload = '{}'`), 'webhook_events is add-only: rows cannot be changed or deleted');
    check('or deleted', await refuses(`DELETE FROM webhook_events`), 'webhook_events is add-only: rows cannot be changed or deleted');
  }

  console.log('\na lead with history cannot be deleted');
  {
    const lead = await makeLead();
    await addNote(lead.id, maya, 'Spoke briefly.');
    const result = await refuses(`DELETE FROM leads WHERE id = ${lead.id}`);
    check('the database refuses', /violates foreign key constraint/.test(result), true);
    check('and the lead, its note and its record are all still there', (await pool.query(
      `SELECT (SELECT count(*) FROM leads WHERE id = $1)::int AS lead,
              (SELECT count(*) FROM notes WHERE lead_id = $1)::int AS notes,
              (SELECT count(*) FROM activity_log WHERE lead_id = $1)::int AS log`,
      [lead.id]
    )).rows[0], { lead: 1, notes: 1, log: 1 });
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
