/**
 * Proves migrations 016 and 017 and db/presence.ts against a real Postgres -
 * T9 and T10, docs/AUTO-CALLS.md "Who is free".
 *
 * What a mock cannot show: that "I can take a call" holds for two minutes and
 * then lapses by itself, so a closed or sleeping browser stops counting with
 * nobody clearing it; that "not now" and ending a session clear it at once;
 * that a deactivated account can never be made ringable; and that "free" -
 * switch on, browser open, no call going - holds for exactly the right people,
 * superadmin or agent. Getting those wrong rings a desk nobody is at, a person
 * who signed out, or someone already talking to a lead. And T15c: that a ring
 * let run out turns the switch off with its record in one statement - never
 * for someone who started a call meanwhile - and that the browser's report is
 * answered with the switch and why it is so. And T16: that "someone on a
 * call" - what keeps a lead on hold - counts only people with the switch on.
 *
 * It writes rows, so it refuses to run against a database that holds users.
 * Run it with the others: scripts/live-checks.sh presence
 */
import { pool } from '../src/db/pool';
import {
  freePeople,
  RINGABLE_SECONDS,
  RINGABLE_SQL,
  setRingable,
  someoneOnOrJustOffCall,
  switchOffAfterMissedRing,
} from '../src/db/presence';
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

async function refuseIfNotEmpty(): Promise<void> {
  const { rows } = await pool.query(`SELECT count(*)::int AS users FROM users`);
  if (rows[0].users > 0) {
    console.error('Refusing to run: this database already holds users. Use a scratch database.');
    process.exit(1);
  }
}

async function makeUser(email: string, role: 'agent' | 'superadmin' = 'agent'): Promise<number> {
  const user = await pgUserStore.create({
    email,
    name: email.split('@')[0],
    role,
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
  });
  return user.id;
}

/** Whether the shared rule counts this person as able to ring now. */
async function ringable(userId: number): Promise<boolean> {
  const { rows } = await pool.query(`SELECT ${RINGABLE_SQL} AS ringable FROM users u WHERE u.id = $1`, [userId]);
  return rows[0].ringable;
}

/** Whole seconds until it lapses, or null when cleared. */
async function secondsLeft(userId: number): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT round(extract(epoch FROM ringable_until - now()))::int AS left FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0].left;
}

async function main(): Promise<void> {
  await refuseIfNotEmpty();
  const maya = await makeUser('maya@example.com');
  const sam = await makeUser('sam@example.com');

  console.log('\nsaying so');
  {
    check('a new account is not ringable - nothing has said it can be', await ringable(maya), false);
    check('and holds nothing', await secondsLeft(maya), null);

    await setRingable(pool, maya, true);
    check('"I can take a call" makes it ringable', await ringable(maya), true);
    check(`for ${RINGABLE_SECONDS} seconds`, await secondsLeft(maya), RINGABLE_SECONDS);
    check('only for that person', await ringable(sam), false);

    await pool.query(`UPDATE users SET ringable_until = now() + interval '30 seconds' WHERE id = $1`, [maya]);
    await setRingable(pool, maya, true);
    check('saying it again starts the two minutes again', await secondsLeft(maya), RINGABLE_SECONDS);

    await setRingable(pool, maya, false);
    check('"not now" - a call, a ring or a note open - clears it at once', await ringable(maya), false);
    check('and holds nothing', await secondsLeft(maya), null);

    await setRingable(pool, maya, false);
    check('"not now" twice is still not ringable', await ringable(maya), false);
  }

  console.log('\nfalling silent');
  {
    await setRingable(pool, maya, true);
    // The two minutes have passed with no word from the browser: closed, offline, asleep.
    await pool.query(`UPDATE users SET ringable_until = now() - interval '1 second' WHERE id = $1`, [maya]);
    check('two minutes with no word: no longer ringable, with nothing clearing it', await ringable(maya), false);

    await pool.query(`UPDATE users SET ringable_until = now() + interval '1 second' WHERE id = $1`, [maya]);
    check('a second before that, still ringable', await ringable(maya), true);
  }

  console.log('\nending the session');
  {
    await setRingable(pool, maya, true);
    await setRingable(pool, sam, true);
    await pgUserStore.update(maya, { bumpSession: true });
    check('signing out clears it at once', await ringable(maya), false);
    check("and leaves everyone else's", await ringable(sam), true);

    await pgUserStore.update(maya, { name: 'Maya Chen' });
    await setRingable(pool, maya, true);
    await pgUserStore.update(maya, { name: 'Maya C.' });
    check('a change that does not end the session leaves it', await ringable(maya), true);
  }

  console.log('\na deactivated account');
  {
    await setRingable(pool, sam, true);
    // As the Agents screen deactivates: is_active off, and every session ended.
    await pgUserStore.update(sam, { isActive: false, bumpSession: true });
    check('deactivating clears it at once', await ringable(sam), false);

    await setRingable(pool, sam, true);
    check('and a browser still open cannot make it ringable again', await ringable(sam), false);
    check('nothing is held for it', await secondsLeft(sam), null);
  }

  console.log('\nthe "Taking calls" switch');
  {
    const ava = await makeUser('ava@example.com');
    const state = async () => {
      const { rows } = await pool.query(
        `SELECT taking_calls AS on, taking_calls_at IS NOT NULL AS stamped, taking_calls_at AS at FROM users WHERE id = $1`,
        [ava]
      );
      return rows[0] as { on: boolean; stamped: boolean; at: Date };
    };
    const fresh = await state();
    check('a new account starts with it off, never switched', [fresh.on, fresh.stamped], [false, false]);

    await pgUserStore.update(ava, { takingCalls: { on: true, why: 'by_hand' } });
    const switchedOn = await state();
    check('switched on: on, with the time it changed', [switchedOn.on, switchedOn.stamped], [true, true]);

    await pool.query(`UPDATE users SET taking_calls_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [ava]);
    await pgUserStore.update(ava, { takingCalls: { on: true, why: 'by_hand' } });
    check('switched on again: the time it changed stays', (await state()).at.toISOString(), '2026-01-01T00:00:00.000Z');

    await pgUserStore.update(ava, { takingCalls: { on: false, why: 'by_hand' } });
    const switchedOff = await state();
    check('switched off: off, and the time moves', [switchedOff.on, switchedOff.at.toISOString() > '2026-01-01T00:00:00.000Z'], [false, true]);

    await pgUserStore.update(ava, { takingCalls: { on: true, why: 'by_hand' } });
    await setRingable(pool, ava, true);
    await pgUserStore.update(ava, { bumpSession: true, takingCalls: { on: false, why: 'sign_out' } });
    check('signing out: off, and not ringable, in one statement', [(await state()).on, await ringable(ava)], [false, false]);
    check('and why it is so is kept with it', (await pgUserStore.findById(ava))!.takingCallsWhy, 'sign_out');
  }

  console.log('\nwho is free');
  {
    const lead = (
      await pool.query(`INSERT INTO leads (phone, first_name, ezt_added_at) VALUES ('+15550000901', 'Pat', now()) RETURNING id`)
    ).rows[0].id as number;
    const kim = await makeUser('kim@example.com');
    const boss = await makeUser('boss@example.com', 'superadmin');
    let sid = 0;
    /** A call of `agentId`'s, still going unless `outcome` is given. */
    const call = async (agentId: number | null, opts: { direction?: string; outcome?: string; startedAgo?: string } = {}) =>
      (
        await pool.query(
          `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, started_at, direction, outcome, ended_at)
           VALUES ($1, $2, $3, now() - $4::interval, $5, $6::text, CASE WHEN $6::text IS NULL THEN NULL ELSE now() END)
           RETURNING id`,
          [lead, agentId, `CA-free-${++sid}`, opts.startedAgo ?? '0 seconds', opts.direction ?? 'outbound', opts.outcome ?? null]
        )
      ).rows[0].id as number;
    const end = (callId: number) =>
      pool.query(`UPDATE calls SET outcome = 'answered', ended_at = now() WHERE id = $1`, [callId]);

    await setRingable(pool, kim, true);
    await setRingable(pool, boss, true);
    check('browser open, switch off: nobody is free - the switch decides', await freePeople(pool), []);

    await pgUserStore.update(kim, { takingCalls: { on: true, why: 'by_hand' } });
    await pgUserStore.update(boss, { takingCalls: { on: true, why: 'by_hand' } });
    check('switch on, browser open, no call: free - agent and superadmin alike', await freePeople(pool), [kim, boss]);

    await pgUserStore.update(boss, { takingCalls: { on: false, why: 'by_hand' } });
    check('a superadmin who switches it off is not free', await freePeople(pool), [kim]);
    await pgUserStore.update(boss, { takingCalls: { on: true, why: 'by_hand' } });

    await pool.query(`UPDATE users SET ringable_until = now() - interval '1 second' WHERE id = $1`, [boss]);
    check('switch on, but the browser silent for two minutes: not free', await freePeople(pool), [kim]);
    await setRingable(pool, boss, false);
    check('switch on, but the browser says busy: not free', await freePeople(pool), [kim]);
    await setRingable(pool, boss, true);

    const placed = await call(kim);
    check('on a call they placed, before the browser says so: not free', await freePeople(pool), [boss]);
    await end(placed);
    check('once it ends: free again', await freePeople(pool), [kim, boss]);

    const ringing = await call(kim, { direction: 'inbound' });
    check('a lead ringing them: not free', await freePeople(pool), [boss]);
    await end(ringing);

    await call(kim, { startedAgo: '3 hours' });
    check('a call whose end was never reported, 3 hours on: no longer keeps them busy', await freePeople(pool), [kim, boss]);

    const robot = await call(null, { direction: 'automated' });
    check('an automated call nobody has taken keeps nobody busy', await freePeople(pool), [kim, boss]);
    await pool.query(`UPDATE calls SET agent_id = $1 WHERE id = $2`, [boss, robot]);
    check('once a person takes its transfer, they are on it: not free', await freePeople(pool), [kim]);
    await end(robot);

    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [kim]);
    await pool.query(`UPDATE users SET ringable_until = now() + interval '1 minute' WHERE id = $1`, [kim]);
    check('deactivated, even with the switch on and a browser open: not free', await freePeople(pool), [boss]);
  }

  console.log('\na transfer let ring out turns the switch off (T15c)');
  {
    const lead = (
      await pool.query(`INSERT INTO leads (phone, first_name, ezt_added_at) VALUES ('+15550000902', 'Lee', now()) RETURNING id`)
    ).rows[0].id as number;
    const transfer = (
      await pool.query(
        `INSERT INTO calls (lead_id, twilio_call_sid, direction) VALUES ($1, 'CA-rang-1', 'automated') RETURNING id`,
        [lead]
      )
    ).rows[0].id as number;
    const ray = await makeUser('ray@example.com');
    const sue = await makeUser('sue@example.com');
    const ned = await makeUser('ned@example.com');
    for (const id of [ray, sue, ned]) await pgUserStore.update(id, { takingCalls: { on: true, why: 'by_hand' } });
    const records = async (userId: number) =>
      (
        await pool.query(
          `SELECT actor_id, subject_user_id, lead_id, detail FROM activity_log
           WHERE action = 'calls.availability_changed' AND subject_user_id = $1 ORDER BY id`,
          [userId]
        )
      ).rows;
    const switchOf = async (userId: number) => {
      const user = (await pgUserStore.findById(userId))!;
      return [user.takingCalls, user.takingCallsWhy];
    };

    // The ring itself made the browser busy: it is not asked.
    await setRingable(pool, ray, false);
    check('rang out, untouched: switched off', await switchOffAfterMissedRing(pool, ray, transfer), true);
    check('off, and why', await switchOf(ray), [false, 'missed_transfer']);
    check('recorded in the same statement - the system\'s doing, the person its subject, the call kept', await records(ray), [
      // jsonb keeps its keys shortest first.
      { actor_id: null, subject_user_id: ray, lead_id: null, detail: { on: false, why: 'missed_transfer', callId: transfer } },
    ]);
    check('the browser\'s next report is answered with it', await setRingable(pool, ray, true), {
      takingCalls: false,
      takingCallsWhy: 'missed_transfer',
    });
    check('the same report again changes nothing, and records nothing', await switchOffAfterMissedRing(pool, ray, transfer), false);
    check('still one record', (await records(ray)).length, 1);

    // Sue started a call of her own while it rang.
    await pool.query(
      `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, direction, started_at) VALUES ($1, $2, 'CA-rang-2', 'outbound', now())`,
      [lead, sue]
    );
    check('on a call by then: kept on', await switchOffAfterMissedRing(pool, sue, transfer), false);
    check('still on, nothing recorded', [await switchOf(sue), await records(sue)], [[true, 'by_hand'], []]);

    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [ned]);
    check('a deactivated account: nothing', await switchOffAfterMissedRing(pool, ned, transfer), false);
    check('an account that is not active is told it is off', await setRingable(pool, ned, true), {
      takingCalls: false,
      takingCallsWhy: null,
    });
  }

  console.log('\nsomeone on a call, or just off one - what keeps a lead on hold (T16, T17)');
  {
    // Start from nobody on a call: earlier sections leave calls going, and
    // calls they ended - an hour ago here, so nobody has just finished one.
    await pool.query(`UPDATE calls SET outcome = 'answered', ended_at = now() WHERE outcome IS NULL`);
    await pool.query(`UPDATE calls SET ended_at = now() - interval '1 hour' WHERE ended_at > now() - interval '1 hour'`);
    const lead = (
      await pool.query(`INSERT INTO leads (phone, first_name, ezt_added_at) VALUES ('+15550000903', 'Kai', now()) RETURNING id`)
    ).rows[0].id as number;
    const zoe = await makeUser('zoe@example.com');
    check('nobody on a call', await someoneOnOrJustOffCall(pool, null), false);

    const busy = (
      await pool.query(
        `INSERT INTO calls (lead_id, agent_id, twilio_call_sid, direction, started_at)
         VALUES ($1, $2, 'CA-hold-1', 'outbound', now()) RETURNING id`,
        [lead, zoe]
      )
    ).rows[0].id as number;
    check('on a call, switch off: not counted - they would never be rung for it', await someoneOnOrJustOffCall(pool, null), false);
    await pgUserStore.update(zoe, { takingCalls: { on: true, why: 'by_hand' } });
    check('on a call, switch on: counted - free soon', await someoneOnOrJustOffCall(pool, null), true);
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [zoe]);
    check('deactivated meanwhile: not counted', await someoneOnOrJustOffCall(pool, null), false);
    await pool.query(`UPDATE users SET is_active = true WHERE id = $1`, [zoe]);
    await pool.query(`UPDATE calls SET outcome = 'answered', ended_at = now() WHERE id = $1`, [busy]);
    await setRingable(pool, zoe, false);
    check('the call ends, the note box open: still counted - free in a moment', await someoneOnOrJustOffCall(pool, null), true);
    await setRingable(pool, zoe, true);
    check('the note done, the browser free: not counted - free now, rung rather than waited for', await someoneOnOrJustOffCall(pool, null), false);
    await setRingable(pool, zoe, false);
    await pool.query(`UPDATE calls SET ended_at = now() - interval '3 minutes' WHERE id = $1`, [busy]);
    check('the note box open three minutes after the call: no longer counted', await someoneOnOrJustOffCall(pool, null), false);

    // Another of the robot's calls ringing its transfer (T20 review): whoever
    // it rings is free again in seconds, or on it.
    const step = (await pool.query(`SELECT id, key FROM call_steps WHERE key = 'q1'`)).rows[0];
    // One robot call per lead: each its own.
    const robotCall = async (sid: string, phone: string, choiceKey: string, label: string): Promise<number> => {
      const own = (
        await pool.query(`INSERT INTO leads (phone, first_name, ezt_added_at) VALUES ($1, 'Pat', now()) RETURNING id`, [phone])
      ).rows[0].id as number;
      const id = (
        await pool.query(
          `INSERT INTO calls (lead_id, twilio_call_sid, direction, started_at) VALUES ($1, $2, 'automated', now()) RETURNING id`,
          [own, sid]
        )
      ).rows[0].id as number;
      await pool.query(
        `INSERT INTO call_answers (call_id, lead_id, step_id, step_key, attempt, heard, result, choice_key, choice_label)
         VALUES ($1, $2, $3, $4, 1, $5, 'choice', $6, $5)`,
        [id, own, step.id, step.key, label, choiceKey]
      );
      return id;
    };
    await robotCall('CA-RING-1', '+15550000911', '2', 'No');
    check('a robot call whose lead said no rings nobody', await someoneOnOrJustOffCall(pool, null), false);
    const yesCall = await robotCall('CA-RING-2', '+15550000912', '1', 'Yes');
    check('another robot call ringing its transfer: someone coming', await someoneOnOrJustOffCall(pool, null), true);
    check('never the call asking itself', await someoneOnOrJustOffCall(pool, yesCall), false);
    await pool.query(`UPDATE calls SET held_at = now() WHERE id = $1`, [yesCall]);
    check('on hold, it rings nobody', await someoneOnOrJustOffCall(pool, null), false);
    await pool.query(`UPDATE calls SET held_at = NULL, script_result = 'transfer_missed' WHERE id = $1`, [yesCall]);
    check('over, nobody took it: rings nobody', await someoneOnOrJustOffCall(pool, null), false);
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
