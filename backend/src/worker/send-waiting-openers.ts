/**
 * Sends the first question to leads that never got it because EZ Texting was
 * down for longer than the opener retry waits.
 *
 * Built 2026-10-16, after EZ Texting blocked the account from 2026-10-14 for
 * two days: every first text failed, the retry used up its five attempts in
 * about nine hours, and a lead more than a day old is never sent one
 * (`worker/retry-openers.ts`). Those leads were paid for and never asked
 * anything. Run by hand - `npm run openers:send-waiting`, its arguments in
 * `core/resend-args.ts` - and `POLLER.md`, "Resending after an outage", says
 * how and when.
 *
 * What it will and will not do:
 *
 * - **Only leads the retry has given up on** (`retryGaveUp`): never one the
 *   retry may still send to, so the two can never text the same lead.
 * - **Only leads nobody has worked.** Two days on, a lead someone picked up,
 *   called, texted, noted, booked or closed has had a person's attention, and
 *   an automated first question would read as broken. The retry, minutes or
 *   hours after a lead arrives, does not need this rule; a resend days later
 *   does.
 * - **Checked again just before each text,** so a lead who replied, was
 *   blocked or was picked up while the command ran is skipped.
 * - **One text at a time, `--every` apart** - 30 seconds by default.
 * - **Stops at the first text EZ Texting refuses or does not answer.** One
 *   refusal after an outage most likely means more; carrying on would only
 *   pile up failures. Run it again to carry on: a lead sent to no longer
 *   matches, so nothing is sent twice.
 * - **One run at a time** - a second would text the same leads.
 *
 * It prints to the terminal and logs nothing of its own: the record of each
 * text is its `messages` row, as for every automated text (`AUDIT.md`).
 */

import { arizonaTime, type ResendOptions } from '../core/resend-args';
import { findOpenersNeverSent, type OpenerNeverSent } from '../db/openers-never-sent';
import type { SendResult } from '../db/outbound';
import { pool } from '../db/pool';
import type { Querier } from '../db/sql';
import { errText } from '../lib/log';
import { sendOpener } from './opener';
import { retryGaveUp } from './retry-openers';

/**
 * Nobody has done anything with the lead: not holding it, and no call, outcome,
 * callback, note or text of a person's.
 */
const NOBODY_HAS_WORKED_IT = `
  l.assigned_to IS NULL
  AND NOT EXISTS (SELECT 1 FROM calls k WHERE k.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM dispositions dp WHERE dp.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM callbacks cb WHERE cb.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM messages pm WHERE pm.lead_id = l.id AND pm.sent_by IS NOT NULL)
`;

const ARRIVED_AT = 'COALESCE(l.ezt_added_at, l.created_at)';

/** The advisory lock that keeps this to one run at a time. */
const RUN_LOCK = 'send-waiting-openers';

export interface WaitingLead extends OpenerNeverSent {
  /** Why the retry will not send it. */
  why: 'abandoned' | 'tooOld';
}

export interface ExpiredWithoutOpener {
  leadId: number;
  arrivedAt: Date;
}

export interface ResendDeps {
  print: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface ResendStop {
  leadId: number;
  /** `unconfirmed`: EZ Texting did not answer in time, so it may have gone out. */
  reason: 'refused' | 'unconfirmed' | 'error';
  detail: string;
}

export interface ResendReport {
  /** Another run held the lock; nothing was looked at or sent. */
  busy: boolean;
  waiting: WaitingLead[];
  /** Expired before a first text went out - listed, never sent. */
  expiredWithoutOpener: ExpiredWithoutOpener[];
  sent: number;
  /** No longer waiting when its turn came. */
  skipped: number;
  /** Blocked by the time its turn came - refused by the do-not-call check. */
  blocked: number;
  stoppedAt: ResendStop | null;
}

/** Leads in the window that the retry has given up on and nobody has worked. */
export async function findWaitingLeads(
  q: Querier,
  window: { from: Date; to: Date },
  now: number
): Promise<WaitingLead[]> {
  const leads = await findOpenersNeverSent(q, {
    where: `${ARRIVED_AT} >= $1 AND ${ARRIVED_AT} < $2 AND ${NOBODY_HAS_WORKED_IT}`,
    params: [window.from, window.to],
  });
  return withReason(leads, now);
}

/** The same test for one lead, made again just before its text. */
async function stillWaiting(q: Querier, leadId: number, now: number): Promise<WaitingLead | null> {
  const leads = await findOpenersNeverSent(q, { where: `l.id = $1 AND ${NOBODY_HAS_WORKED_IT}`, params: [leadId] });
  return withReason(leads, now)[0] ?? null;
}

function withReason(leads: OpenerNeverSent[], now: number): WaitingLead[] {
  return leads.flatMap((lead) => {
    const why = retryGaveUp(lead, now);
    return why ? [{ ...lead, why }] : [];
  });
}

/**
 * Leads in the window whose conversation expired before any first text went
 * out. Too late to ask them anything - the conversation is over - so they are
 * listed for the person running this, and never sent to.
 */
export async function findExpiredWithoutOpener(
  q: Querier,
  window: { from: Date; to: Date }
): Promise<ExpiredWithoutOpener[]> {
  const { rows } = await q.query(
    `SELECT l.id, ${ARRIVED_AT} AS arrived_at
     FROM leads l
     JOIN LATERAL (
       SELECT c.status, c.expires_at FROM conversations c
       WHERE c.lead_id = l.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1
     ) c ON true
     WHERE c.status = 'expired'
       AND c.expires_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM messages m
         WHERE m.lead_id = l.id AND m.direction = 'outbound'
           AND m.delivery_status IS DISTINCT FROM 'failed'
       )
       AND ${ARRIVED_AT} >= $1 AND ${ARRIVED_AT} < $2
     ORDER BY arrived_at, l.id`,
    [window.from, window.to]
  );
  return rows.map((row) => ({ leadId: row.id as number, arrivedAt: new Date(row.arrived_at as Date) }));
}

/**
 * Runs the command: lists the waiting leads, then - unless it is a dry run -
 * texts them one at a time. Never throws for a failed text; it stops and says
 * so in the report.
 */
export async function resendWaitingOpeners(options: ResendOptions, deps: ResendDeps): Promise<ResendReport> {
  const report: ResendReport = {
    busy: false,
    waiting: [],
    expiredWithoutOpener: [],
    sent: 0,
    skipped: 0,
    blocked: 0,
    stoppedAt: null,
  };

  // Held on a client of its own for the whole run, so it lasts as long as the
  // run does and is let go even if the process is killed (the connection
  // closes).
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [RUN_LOCK]);
    if (!rows[0].locked) {
      report.busy = true;
      deps.print('Another run of this command is going. Let it finish, then run it again.');
      return report;
    }
    try {
      await run(options, deps, report);
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [RUN_LOCK]);
    }
  } finally {
    lockClient.release();
  }
  return report;
}

async function run(options: ResendOptions, deps: ResendDeps, report: ResendReport): Promise<void> {
  const { print } = deps;
  const window = { from: options.from, to: options.to };

  report.waiting = await findWaitingLeads(pool, window, deps.now());
  report.expiredWithoutOpener = await findExpiredWithoutOpener(pool, window);

  printList(options, report, print);
  if (options.dryRun) {
    print('Dry run: nothing was sent.');
    return;
  }
  if (report.waiting.length === 0) return;

  print('');
  let lastSendAt: number | null = null;
  let turn = 0;

  for (; turn < report.waiting.length; turn++) {
    if (options.limit !== null && report.sent >= options.limit) break;
    const listed = report.waiting[turn];

    // Never two texts closer than --every, counted from the start of the last
    // send - a skipped lead does not make the next one wait again.
    if (lastSendAt !== null) {
      const wait = lastSendAt + options.everyMs - deps.now();
      if (wait > 0) await deps.sleep(wait);
    }

    const lead = await stillWaiting(pool, listed.leadId, deps.now());
    if (!lead) {
      report.skipped++;
      print(`  skipped  ${label(listed)} - no longer waiting: replied, picked up or blocked since the list was made`);
      continue;
    }

    lastSendAt = deps.now();
    let result: SendResult;
    try {
      result = await sendOpener({ id: lead.leadId, phone: lead.phone, firstName: lead.firstName }, lead.template);
    } catch (err) {
      // Before the send (the database refused the row - nothing went out) or
      // after it (the text went out, and its row says so; only the reply
      // window was not saved). Either way something is wrong with the
      // database, and the person running this should look before carrying on.
      report.stoppedAt = { leadId: lead.leadId, reason: 'error', detail: errText(err) };
      break;
    }

    if (result.sent) {
      report.sent++;
      print(`  sent     ${label(lead)}`);
      continue;
    }
    if (result.blocked) {
      report.blocked++;
      print(`  blocked  ${label(lead)} - on the do-not-call list, not sent`);
      continue;
    }
    report.stoppedAt = {
      leadId: lead.leadId,
      reason: result.unconfirmed ? 'unconfirmed' : 'refused',
      detail: errText(result.err),
    };
    break;
  }

  printOutcome(report, report.waiting.length - turn, print);
}

function label(lead: OpenerNeverSent): string {
  return `#${lead.leadId} ${lead.firstName ?? '-'} ··${lead.phone.slice(-4)}`;
}

function printList(options: ResendOptions, report: ResendReport, print: ResendDeps['print']): void {
  const { waiting, expiredWithoutOpener } = report;
  print(`Leads that arrived ${arizonaTime(options.from)} to ${arizonaTime(options.to)}, Arizona time.`);
  print('');

  if (waiting.length === 0) {
    print('None is waiting for a first text.');
  } else {
    print(`${waiting.length} waiting for a first text, oldest first:`);
    for (const lead of waiting) {
      const tried = lead.attempts === 0 ? 'never tried' : `${lead.attempts} failed attempt${lead.attempts === 1 ? '' : 's'}`;
      print(`  ${label(lead)}  arrived ${arizonaTime(lead.arrivedAt)}  ${tried}`);
    }
    const toSend = options.limit === null ? waiting.length : Math.min(options.limit, waiting.length);
    const minutes = Math.ceil(((toSend - 1) * options.everyMs) / 60_000);
    print(
      `${options.dryRun ? 'Would send' : 'Sending'} ${toSend}, one every ${options.everyMs / 1000} seconds` +
        (minutes > 0 ? ` - about ${minutes} minute${minutes === 1 ? '' : 's'}.` : '.')
    );
  }

  if (expiredWithoutOpener.length > 0) {
    print('');
    print(
      `${expiredWithoutOpener.length} expired before a first text and will not be sent one: ` +
        expiredWithoutOpener.map((lead) => `#${lead.leadId}`).join(', ')
    );
  }
}

function printOutcome(report: ResendReport, notReached: number, print: ResendDeps['print']): void {
  print('');
  const stop = report.stoppedAt;
  if (stop) {
    const why =
      stop.reason === 'refused'
        ? `EZ Texting refused it (${stop.detail})`
        : stop.reason === 'unconfirmed'
          ? 'EZ Texting did not answer in time, so it may have gone out; it will not be sent again'
          : `the database failed (${stop.detail})`;
    print(`Stopped at #${stop.leadId}: ${why}.`);
  }

  const parts = [`${report.sent} sent`];
  if (report.skipped > 0) parts.push(`${report.skipped} skipped`);
  if (report.blocked > 0) parts.push(`${report.blocked} blocked`);
  print(`${stop ? 'So far' : 'Done'}: ${parts.join(', ')}.`);

  // The lead it stopped at is still to do when it was refused; one that may
  // have gone out is not.
  const left = notReached - (stop?.reason === 'unconfirmed' ? 1 : 0);
  if (left > 0) {
    print(`${left} still waiting. Run the same command again to carry on - nothing is sent twice.`);
  }
}
