/**
 * Proves migrations 015 and 018 and db/call-script.ts against a real Postgres
 * - T6, docs/AUTO-CALLS.md.
 *
 * What a mock cannot show: that the script in the database is the one agreed,
 * word for word, as 015 seeds it and 018 changes it; that the guards on the tables hold - one active script, a choice that
 * either leads on or ends, never into another script, never on 9; and that
 * what a lead said can be added and never changed. Getting those wrong is a
 * call that says the wrong thing, loops, or loses the record of an answer.
 *
 * It writes rows, so it refuses to run against a database that holds leads.
 * Run it with the others: scripts/live-checks.sh call-script
 */
import type { CallScript } from '../src/core/call-script';
import { ANTIBIOTICS_CALL } from '../src/core/call-script-fixtures';
import { loadActiveCallScript } from '../src/db/call-script';
import { pool } from '../src/db/pool';

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

/** A script with its database ids replaced by step keys, so two copies compare by content. */
function shape(script: CallScript) {
  const keyOf = new Map(script.steps.map((st) => [st.id, st.key]));
  const { id: _id, ...rest } = script;
  return {
    ...rest,
    steps: script.steps.map(({ id: _stepId, choices, ...step }) => ({
      ...step,
      choices: choices.map((c) => ({ ...c, nextStepId: c.nextStepId === null ? null : keyOf.get(c.nextStepId) })),
    })),
  };
}

/** The constraint or trigger a statement broke, or 'accepted'. */
async function refusedBy(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await pool.query(sql, params);
    return 'accepted';
  } catch (err) {
    const e = err as { constraint?: string; message: string };
    return e.constraint ?? e.message;
  }
}

async function main(): Promise<void> {
  const { rows: existing } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
  if (existing[0].n > 0) {
    console.error('Refusing to run: this database already holds leads. Use a scratch database.');
    process.exit(1);
  }

  console.log('\nthe script, as agreed');
  const script = await loadActiveCallScript(pool);
  {
    check('there is one, and it is active', script?.key, 'antibiotics');
    check('spoken in its voice - Kore, chosen by ear (018)', script?.voice, 'Google.en-US-Chirp3-HD-Kore');
    check('two steps, in order', script?.steps.map((s) => [s.key, s.position, s.heading]), [
      ['q1', 10, 'Offer'],
      ['q2', 20, 'Link'],
    ]);
    const [q1, q2] = script!.steps;
    check(
      'it opens as decided: who is calling, the offer, then the question - no "automated call" line (018)',
      q1.body,
      "Hi, this is Seri calling from eDrugstore. Today we're offering 25% off antibiotics. Are you interested in ordering?"
    );
    check(
      'asking again asks for keys, and offers 9 to stop - "did not" written out (018)',
      q1.repeatBody,
      'Sorry, I did not catch that. Press 1 for yes, 2 for no, or 9 to stop these calls.'
    );
    check('stop is said plainly - "will not", never a "won\'t" heard as "will" (018)', script?.optOutBody, 'Okay, we will not call you again. Goodbye.');
    check('q1: yes transfers, no leads to q2', q1.choices.map((c) => [c.key, c.label, c.ending, c.nextStepId]), [
      ['1', 'Yes', 'transfer', null],
      ['2', 'No', null, q2.id],
    ]);
    check('q1 yes says', q1.choices[0].reply, 'Great, connecting you with a live agent now. Please hold.');
    check('q2: yes texts the link, no ends', q2.choices.map((c) => [c.key, c.label, c.ending, c.nextStepId]), [
      ['1', 'Yes', 'send_link', null],
      ['2', 'No', 'declined', null],
    ]);
    check('"not interested" is a No, so the longer phrase can win over "interested"', q1.choices[1].words.includes('not interested'), true);
    check('"don\'t text" is a No on the link', q2.choices[1].words.includes("don't text"), true);
    check('stop words, on every step', script!.optOutWords.includes('stop calling'), true);
    check('no email anywhere - the voicemail ends at calling back', script!.voicemailBody.endsWith('Please call us back at {callback_number}. Thanks, and have a great day!'), true);
    check('the link is the one the SMS script sends', script!.linkText.includes('https://www.edrugstore.com/anti-ez'), true);
    // The unit tests (core/answers.spoken.test.ts, and T8's) use a copy of the
    // script; it must be the script the database holds, word for word.
    check('the tests\' copy of the script is this one, word for word', shape(script!), shape(ANTIBIOTICS_CALL));
  }

  console.log('\nwhen it calls - the settings');
  {
    const { rows } = await pool.query(`SELECT key, value FROM settings WHERE key LIKE 'auto_call_%' ORDER BY key`);
    check('every one, with its value', Object.fromEntries(rows.map((r) => [r.key, r.value])), {
      auto_call_days: 'mon,tue,wed,thu,fri',
      auto_call_hold_max_minutes: '10',
      auto_call_hours_end: '17:00',
      auto_call_hours_start: '11:00',
      auto_call_min_confidence: '0.4',
      auto_call_ring_seconds: '25',
      auto_call_time_zone: 'America/Phoenix',
      auto_call_wait_minutes: '60',
    });
  }

  console.log('\nthe guards on the script');
  {
    const [q1, q2] = script!.steps;
    const choice = (stepId: number, key: string, next: number | null, ending: string | null) =>
      refusedBy(
        `INSERT INTO call_choices (script_id, step_id, key, label, reply_body, next_step_id, ending)
         VALUES ($1, $2, $3, 'X', 'x', $4, $5)`,
        [script!.id, stepId, key, next, ending]
      );

    check(
      'a second active script is refused',
      await refusedBy(
        `INSERT INTO call_scripts (key, name, voice, opt_out_words, opt_out_body, no_response_body, voicemail_body, busy_body, hold_body, link_text, is_active)
         VALUES ('other', 'Other', 'v', '{}', 'x', 'x', 'x', 'x', 'x', 'x', true)`
      ),
      'call_scripts_one_active'
    );
    check('a choice that both leads on and ends is refused', await choice(q1.id, '3', q2.id, 'declined'), 'call_choices_next_or_end');
    check('a choice that does neither is refused', await choice(q1.id, '3', null, null), 'call_choices_next_or_end');
    check('9 is never a choice - it is stop', await choice(q1.id, '9', null, 'declined'), 'call_choices_key_check');
    check('an ending the call does not have is refused', await choice(q1.id, '3', null, 'offers'), 'call_choices_ending_check');
    check('the same key twice on a step is refused', await choice(q1.id, '1', null, 'declined'), 'call_choices_step_id_key_key');

    const { rows: other } = await pool.query(
      `WITH s AS (
         INSERT INTO call_scripts (key, name, voice, opt_out_words, opt_out_body, no_response_body, voicemail_body, busy_body, hold_body, link_text)
         VALUES ('other', 'Other', 'v', '{}', 'x', 'x', 'x', 'x', 'x', 'x') RETURNING id
       )
       INSERT INTO call_steps (script_id, key, position, heading, body, repeat_body)
       SELECT id, 'q1', 10, 'H', 'b', 'r' FROM s RETURNING id`
    );
    check("a choice can never lead into another script's step", await choice(q1.id, '3', other[0].id, null), 'call_choices_next_in_script');
  }

  console.log('\nwhat a lead said - added, never changed');
  {
    const { rows: lead } = await pool.query(`INSERT INTO leads (phone, first_name) VALUES ('+15550000801', 'Ana') RETURNING id`);
    const { rows: call } = await pool.query(
      `INSERT INTO calls (lead_id, twilio_call_sid, direction, started_at) VALUES ($1, 'AUTO-801', 'automated', now()) RETURNING id`,
      [lead[0].id]
    );
    const q1 = script!.steps[0];
    const answer = (attempt: number, result: string, key: string | null, label: string | null, confidence: number | null = 0.91) =>
      refusedBy(
        `INSERT INTO call_answers (call_id, lead_id, step_id, step_key, attempt, heard, confidence, digits, result, choice_key, choice_label)
         VALUES ($1, $2, $3, 'q1', $4, 'yeah sure', $5, NULL, $6, $7, $8)`,
        [call[0].id, lead[0].id, q1.id, attempt, confidence, result, key, label]
      );

    check('an answer is kept, with what was heard and how sure', await answer(1, 'choice', '1', 'Yes'), 'accepted');
    check('the same asking cannot be saved twice - a repeated webhook', await answer(1, 'choice', '1', 'Yes'), 'call_answers_call_id_step_id_attempt_key');
    check('changing it is refused', await refusedBy(`UPDATE call_answers SET choice_label = 'No'`), 'call_answers is add-only: rows cannot be changed or deleted');
    check('deleting it is refused', await refusedBy(`DELETE FROM call_answers`), 'call_answers is add-only: rows cannot be changed or deleted');
    check('a choice must say which', await answer(2, 'choice', null, null), 'call_answers_check');
    check('anything else must not', await answer(2, 'unclear', '1', 'Yes'), 'call_answers_check');
    check('a confidence outside 0 to 1 is refused', await answer(2, 'unclear', null, null, 1.5), 'call_answers_confidence_check');
    check('an unclear second asking is kept', await answer(2, 'unclear', null, null), 'accepted');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
