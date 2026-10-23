/**
 * Proves migration 020 and db/hold-offers.ts against a real Postgres - T17,
 * docs/AUTO-CALLS.md "The hold line".
 *
 * What a mock cannot show: that a lead on hold is offered to someone truly
 * free - the switch on, a browser open, no call going - longest waiting
 * first; that the database holds one offer at a time per lead and per person,
 * so two triggers at once cannot both ring; that the same lead is never
 * offered twice to the same person, however the first offer ended; that an
 * offer is ended once and never removed; that taking the transfer ends the
 * offer as taken; and who counts as still coming for a lead. Getting those
 * wrong rings one person with two leads, rings someone who already said no,
 * or keeps a lead waiting for nobody.
 *
 * It writes rows, so it refuses to run against a database that holds leads.
 * Run it with the others: scripts/live-checks.sh hold-offers
 */
import { holdCall, linkAutomatedCall, missTransfer, startAutomatedCall, takeTransfer } from '../src/db/auto-calls';
import {
  endOffer,
  endStaleOffers,
  liveOffer,
  someoneComing,
  startOffer,
} from '../src/db/hold-offers';
import { pool } from '../src/db/pool';
import { setRingable } from '../src/db/presence';
import { pgUserStore } from '../src/db/users';

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

async function refusedBy(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await pool.query(sql, params);
    return 'accepted';
  } catch (err) {
    const e = err as { constraint?: string; message: string };
    return e.constraint ?? e.message;
  }
}

async function refuseIfNotEmpty(): Promise<void> {
  const { rows } = await pool.query(`SELECT count(*)::int AS leads FROM leads`);
  if (rows[0].leads > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }
}

/** Someone free: the switch on, a browser open, no call. */
async function freePerson(email: string): Promise<number> {
  const user = await pgUserStore.create({
    email,
    name: email.split('@')[0],
    role: 'agent',
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
  });
  await pgUserStore.update(user.id, { takingCalls: { on: true, why: 'by_hand' } });
  await setRingable(pool, user.id, true);
  return user.id;
}

/** A lead's automated call, answered, put on hold `minutesAgo` ago. */
async function onHold(phone: string, callSid: string, minutesAgo: number): Promise<number> {
  const lead = (
    await pool.query(`INSERT INTO leads (phone, first_name, ezt_added_at) VALUES ($1, 'Pat', now()) RETURNING id`, [phone])
  ).rows[0].id as number;
  const started = await startAutomatedCall({ leadId: lead, mayRing: () => true });
  const callId = started.ok ? started.callId : 0;
  await linkAutomatedCall(callId, callSid);
  await holdCall(callId);
  await pool.query(`UPDATE calls SET held_at = now() - ($2 || ' minutes')::interval WHERE id = $1`, [callId, String(minutesAgo)]);
  return callId;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();

  console.log('\nthe table (020)');
  {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'auto_call_offer_ring_seconds'`);
    check('the ring time is a setting: 20 seconds', rows[0]?.value, '20');
  }

  const maya = await freePerson('maya@example.com');
  const sam = await freePerson('sam@example.com');
  const first = await onHold('+15550000701', 'CA-OFFER-1', 3);
  const second = await onHold('+15550000702', 'CA-OFFER-2', 1);

  console.log('\nwho is offered');
  let mayaOffer = 0;
  {
    const offer = await startOffer(maya);
    mayaOffer = offer?.offerId ?? 0;
    check('Maya comes free: the lead who has waited longest rings her', [offer?.callId, offer?.callSid, offer?.agentId], [
      first,
      'CA-OFFER-1',
      maya,
    ]);
    check('it is live', (await liveOffer(first))?.agentId, maya);
    check('Maya is not offered a second lead while it rings', await startOffer(maya), null);
    const next = await startOffer();
    check('Sam, free too: the next in line rings him', [next?.callId, next?.agentId], [second, sam]);
    check('nobody else free: nothing more', await startOffer(), null);

    check(
      'the database holds one live offer per lead',
      await refusedBy(`INSERT INTO call_offers (call_id, agent_id) VALUES ($1, $2)`, [first, sam]),
      'call_offers_one_live_per_call'
    );
    check('a second ending changes nothing', [await endOffer(second, next!.offerId, 'declined'), await endOffer(second, next!.offerId, 'missed')], [
      sam,
      null,
    ]);
    check(
      'an ended offer cannot be changed',
      await refusedBy(`UPDATE call_offers SET outcome = 'taken' WHERE id = $1`, [next!.offerId]),
      "call_offers: an ended offer cannot be changed"
    );
    check('nor removed', await refusedBy(`DELETE FROM call_offers WHERE id = $1`, [next!.offerId]), 'call_offers: rows cannot be deleted');
    check(
      'an end not one of the seven is refused',
      await refusedBy(`INSERT INTO call_offers (call_id, agent_id, ended_at, outcome) VALUES ($1, $2, now(), 'maybe')`, [first, sam]),
      'call_offers_outcome_check'
    );
    check('Sam declined the second lead: never offered it again', await startOffer(sam), null);
  }

  console.log('\nwho is still coming for a lead');
  {
    // Maya is ringing with the first lead; Sam declined the second.
    check('for the second: Maya, ringing with another lead - free again soon', await someoneComing(second), true);
    await endOffer(first, mayaOffer, 'missed');
    const again = await startOffer(maya);
    check('Maya, free again: the second lead rings her - never the first again', [again?.callId, again?.agentId], [second, maya]);
    await endOffer(second, again!.offerId, 'declined');
    const samFirst = await startOffer(sam);
    check('Sam is offered the first, which he never had', [samFirst?.callId, samFirst?.agentId], [first, sam]);
    await endOffer(first, samFirst!.offerId, 'declined');
    check('both have had both, nobody on a call: nobody is coming', [await someoneComing(first), await someoneComing(second)], [
      false,
      false,
    ]);
    check('and nothing is offered', await startOffer(), null);

    const lee = await freePerson('lee@example.com');
    await setRingable(pool, lee, false);
    await pool.query(
      `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, direction, started_at)
       SELECT lead_id, $1, 'CA-LEE-1', 'outbound', now() FROM calls WHERE id = $2`,
      [lee, first]
    );
    check('Lee, switch on, on a call: coming - free soon', await someoneComing(first), true);
    await pool.query(`UPDATE users SET taking_calls = false WHERE id = $1`, [lee]);
    check('Lee on a call with the switch off: not coming', await someoneComing(first), false);
    await pool.query(`UPDATE users SET taking_calls = true WHERE id = $1`, [lee]);
    await pool.query(`UPDATE calls SET outcome = 'answered', ended_at = now() WHERE twilio_call_sid = 'CA-LEE-1'`);
    check('Lee\'s call ends, the note box open: coming - free in a moment', await someoneComing(first), true);
    await pool.query(`UPDATE calls SET ended_at = now() - interval '3 minutes' WHERE twilio_call_sid = 'CA-LEE-1'`);
    check('the note box still open three minutes on: no longer coming', await someoneComing(first), false);
    await pool.query(
      `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, direction, started_at)
       SELECT lead_id, $1, 'CA-SAM-1', 'outbound', now() FROM calls WHERE id = $2`,
      [sam, first]
    );
    check('Sam, who said no to the first, now on a call: not coming for it', await someoneComing(first), false);
    await pool.query(`UPDATE calls SET outcome = 'answered', ended_at = now() - interval '1 hour' WHERE twilio_call_sid = 'CA-SAM-1'`);
    // Both hear the busy line: no longer waiting.
    await missTransfer(first);
    await missTransfer(second);
  }

  console.log('\nfree means free');
  {
    const third = await onHold('+15550000703', 'CA-OFFER-3', 0);
    const ana = await freePerson('ana@example.com');
    await pool.query(`UPDATE users SET taking_calls = false WHERE id = $1`, [ana]);
    check('the switch off: not offered', await startOffer(ana), null);
    await pool.query(`UPDATE users SET taking_calls = true WHERE id = $1`, [ana]);
    await setRingable(pool, ana, false);
    check('the browser busy or closed: not offered', await startOffer(ana), null);
    await setRingable(pool, ana, true);
    const offer = await startOffer(ana);
    check('free: offered', [offer?.callId, offer?.agentId], [third, ana]);

    const taken = await takeTransfer(third, ana);
    const { rows } = await pool.query(`SELECT outcome FROM call_offers WHERE id = $1`, [offer!.offerId]);
    check('she takes it: the offer ended taken, with the transfer', [taken.ok, rows[0].outcome], [true, 'taken']);
    check('a lead taken is no longer offered', await startOffer(), null);
  }

  console.log('\nan offer never heard back, and a lead gone');
  {
    const fourth = await onHold('+15550000704', 'CA-OFFER-4', 0);
    const ben = await freePerson('ben@example.com');
    const offer = await startOffer(ben);
    await pool.query(`ALTER TABLE call_offers DISABLE TRIGGER call_offers_end_once`);
    await pool.query(`UPDATE call_offers SET offered_at = now() - interval '2 minutes' WHERE id = $1`, [offer!.offerId]);
    await pool.query(`ALTER TABLE call_offers ENABLE TRIGGER call_offers_end_once`);
    check('an offer open after a minute is no longer live', await liveOffer(fourth), null);
    check('and is ended, expired', await endStaleOffers(), 1);
    const { rows } = await pool.query(`SELECT outcome FROM call_offers WHERE id = $1`, [offer!.offerId]);
    check('expired', rows[0].outcome, 'expired');

    await missTransfer(fourth);
    const cara = await freePerson('cara@example.com');
    check('a lead no longer on hold - the busy line - is never offered', await startOffer(cara), null);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
