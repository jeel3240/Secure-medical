# T25 · Everything written down and checked end to end

**Goal:** the docs describe what was built, and one script proves the whole
path.

**Depends on:** T0-T24 · **Size:** - · **Status:** Done 2026-10-25 - every doc read
against the code, the faults fixed; `npm run e2e`, 93 checks, three robot calls ·
**Deploy note:** none.

## Build

- This doc: every section says what is built.
- `LEAD-FLOW.md` and `CLAUDE.md` mention robot calls.
- The end-to-end script (`npm run e2e`) covers a robot call, with Twilio's
  requests simulated.

**Files:** `backend/scripts/end-to-end.ts`, `backend/src/db/auto-dial.ts` and
`backend/src/worker/auto-calls.ts` (comments only), docs.

## Done when

- [x] `npm run e2e` passes - 93 checks (52 before), on a scratch database
      and, as `docs/README.md` runs it, inside the api container.
- [x] A read of every doc against the code finds nothing out of date - five
      independent reads, each confirmed in the code before it was fixed.

## Docs to update in the same commit

`AUTO-CALLS.md`; `README.md` (both), `CLAUDE.md`, `LEAD-FLOW.md`,
`QUEUE.md`, `ADMIN.md`, `ADMIN-LEADS.md`, `FRONTEND.md`, `WEBHOOKS.md`,
`STATE-MACHINE.md`, `AUTH.md`, `TWILIO.md`, `AUDIT.md`, `POLLER.md`,
`WORKFLOW.md`.

## As built

**The end-to-end script** gained steps 10 to 13: automated calls
switched on; an agent who signs in, says her browser can take a call and
switches Taking calls on, through the routes the browser uses; three leads
who never replied. The worker's own look, wired as `worker/index.ts` wires
it, calls them one at a time, one person being free: **Casey** says "Yes, I
am." and Maya takes the transfer - the lead hers, the call `transferred`,
answered, on the timeline with what was said, Working on Admin > Leads;
**Riley** presses 1 and Maya lets it ring out - the busy line,
`transfer_missed`, Maya switched off (`missed_transfer`), Riley first in the
queue as Wants a call until Maya calls back; **Avery** says no, then "Sure,
text me." - the link texted once, Awaiting reply and Link sent at once.
Twilio is stubbed at its library's one request method, which answers only
"place this call", so what we ask for - the number, our webhooks, voicemail
detection - is built by the real code and checked; its webhooks are posted
signed, each at the address the previous answer gave. Before that, the
script's own two faults, hidden by `--transpile-only`: the app built without
calling's settings, and an outcome retired on 2026-09-28 (`interested`) -
step 8 now releases, then saves Closed.

**The doc read** - every doc, split five ways, read against the code by
independent reviewers, each finding confirmed before fixing. Not wrong:
`LOGGING.md` (88 log events, every one listed), `SCHEMA.md` (25 tables).
Fixed: a queue rule left out of `LEAD-FLOW.md` and `ADMIN-LEADS.md` (the
missed "yes"); `QUEUE.md` pointing at the wrong live check for T22, and
misreading what the read-flag check proves; `FRONTEND.md`'s calling and test
counts; Admin > Leads' view said to be in memory; `WEBHOOKS.md`'s Twilio
routes (sixteen, not seven), its blocking paths (a stop on the call) and the
keyword punctuation (only a trailing `.`, `!` or `,`); `AUTH.md` - signing
out ends every session of that person; `TWILIO.md` - incoming calls with
automated calls on, the recording notice heard on real calls, an automated
call's `started_at`, which stale calls are closed; `AUDIT.md` -
`reply.before_our_text` is a log line, and the local `--unblock`;
`POLLER.md`'s `suppressed` counter; `CLAUDE.md`'s calling row, `core/`,
the root README and `lib/call-settings.ts`; `WORKFLOW.md`'s migrations
passage rewritten plainly; `AUTO-CALLS.md`'s "first switched on", which is "last" -
two code comments said the same. **One behaviour left for a decision**
(`STATE-MACHINE.md`, "The missed-call text"): the robot calls leads still on
Q1, so a "thanks" to the link text, or to the missed-call text after calling
the robot back, got Q1's "Sorry, please reply 1 for Yes or 2 for No." - Jeel,
2026-10-27: fix it. W2.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
