# Phase 6 tickets: automated calls

The build of the robot's call - [`AUTO-CALLS.md`](../AUTO-CALLS.md), with its two
parts [`AUTO-CALL-SCRIPT.md`](../AUTO-CALL-SCRIPT.md) and
[`AUTO-CALL-TRANSFER.md`](../AUTO-CALL-TRANSFER.md) - split into small tickets.
Every ticket is done, and the robot has been live on production since 2026-10-30.
Each ticket was one branch off `dev` and one PR into `dev`, with its code, its tests
and its doc lines. Read the design first, then the ticket.

**The ids.** Phase 6's tickets are `T0` to `T29`, with `T13b`, and `T15a` to `T15c`
in place of a T15 (below, "The order"). The code cites them as they are written -
`T0`, `T13b` - so each file's heading keeps that id (`# T0 · ...`), and its name has
two digits so the folder sorts: `T00-resend-first-texts.md`,
`T13b-spoken-answers-faster.md`. The tickets were not sized, so their Size is `-`.

**How the tickets were written.** Until 2026-11-27 they were inside `AUTO-CALLS.md`,
each with Goal, Needs, Production, Build, Done when, As built, Files and Doc. They
moved here with only the headings changed onto `docs/templates/TICKET.md`'s: Needs
is *Depends on*, Production the *Deploy note*, Files the end of *Build*, and Doc
*Docs to update in the same commit*. The real-call notes the design doc kept were
added to the *As built* of the ticket whose calls they were. A ticket's "Docs to
update" names the doc it changed at the time; its *As built* names where the design
is written now - "Where the sections are now", below.

## The rules every ticket keeps

- **One ticket, one branch, one PR.** One branch off `dev`, one PR into `dev`, with
  its code, tests and doc lines. The next started after the last was merged. The
  status was updated in the ticket's own PR.
- **The gates.** Every check under *Done when* passed before the PR was opened. On
  top of them, every PR passed `npm test`, `npm run lint`, both builds and
  `docker compose build api worker`, and `scripts/live-checks.sh` when it touched
  SQL.
- **Production kept working.** Every calling ticket was merged and deployed with
  `AUTO_CALLS` off: the header switch, group rings, the call-back change and the
  dialler all depend on it. With it off, a deploy still showed Admin's new parts -
  an empty Call column on Admin > Leads (T23), and the Calls tab on Admin >
  Configuration, saying it is off (T24). Each ticket's *Deploy note* says what the
  live app saw once it was deployed. T26 switched it on.
- **Never production's number.** Development called from the second Twilio number,
  (480) 530-8582, never production's (480) 470-8259 (T1 to T3).

## The tickets

| # | Ticket | Depends on | Size | Status |
|---|---|---|---|---|
| T0 | [Resend the first texts the EZ Texting block stopped](T00-resend-first-texts.md) | - | - | Done 2026-10-16 - run on the server for the 174 leads of the block |
| | **Setup** | | | |
| T1 | [A laptop can never ring for production's calls](T01-laptop-never-rings-for-production.md) | - | - | Done 2026-10-16 |
| T2 | [`twilio:configure` cannot move production's number](T02-configure-cannot-move-production-number.md) | - | - | Done 2026-10-16 |
| T3 | [Set up the new number for local work](T03-new-number-for-local-work.md) | T1, T2 | - | Done 2026-10-17 - a real call each way on the dev number |
| | **Data and rules - no calls yet** | | | |
| T4 | [The database can hold a robot call](T04-database-holds-a-robot-call.md) | - | - | Done 2026-10-18 |
| T5 | [The screens know a robot call from an agent's call](T05-screens-know-a-robot-call.md) | T4 | - | Done 2026-10-18 |
| T6 | [The call script saved as rows](T06-call-script-as-rows.md) | T4 | - | Done 2026-10-18 |
| T7 | [Understanding a spoken answer](T07-understanding-a-spoken-answer.md) | T6 | - | Done 2026-10-18 |
| T8 | [What the robot does after each answer](T08-what-follows-each-answer.md) | T6, T7 | - | Done 2026-10-18 |
| | **Who can take a call** | | | |
| T9 | [The server knows who is online](T09-server-knows-who-is-online.md) | - | - | Done 2026-10-18 |
| T10 | [The "Taking calls" switch](T10-taking-calls-switch.md) | T9 | - | Done 2026-10-18 |
| T11 | [Several browsers ringing at once](T11-several-browsers-ringing.md) | - | - | Done 2026-10-18 |
| | **The call - on the dev number** | | | |
| T12 | [The server places one call](T12-server-places-one-call.md) | T3, T4, T6 | - | Done 2026-10-18 - a real call to Jeel's phone; the opening and voice changed after it (018) |
| T13 | [The questions](T13-the-questions.md) | T7, T8, T12 | - | Done 2026-10-19 - six real calls, every path |
| T13b | [Spoken answers understood faster](T13b-spoken-answers-faster.md) | T13 | - | Done 2026-10-19 - Deepgram: 4 s of silence down to 2.4-3.3 s, measured |
| T14 | [Text the link](T14-text-the-link.md) | T13 | - | Done 2026-10-19 - the link reached Jeel's phone |
| T15a | [The transfer: everyone free](T15a-transfer-everyone-free.md) | T10, T11, T13 | - | Done 2026-10-20 - real transfers: taken, taken after a decline, taken by nobody |
| T15b | [The transfer: the lead's own agent first](T15b-transfer-own-agent-first.md) | T15a | - | Done 2026-10-20 - real calls: rung alone first, then the others; not free, not waited for |
| T15c | [Letting a transfer ring out turns the switch off](T15c-ring-out-turns-switch-off.md) | T15a | - | Done 2026-10-20 - real calls: ran out, taken by another, declined, note box open |
| T16 | [The hold line](T16-the-hold-line.md) | T15a | - | Done 2026-10-21 - real calls: on hold with music, out when nobody is on a call, the safety stop |
| T17 | [The next free person gets the waiting lead](T17-next-free-person-gets-the-lead.md) | T16 | - | Done 2026-10-22 - real calls: rung when the call ended, when the note was saved, when skipped; declined and rang out back on hold |
| T18 | [Voicemail](T18-voicemail.md) | T12 | - | Done 2026-10-24 - real calls: a real voicemail, the whole message; a beep while the call spoke, and while a transfer rang |
| T19 | [A lead calling back reaches someone](T19-lead-calling-back.md) | T10, T11 | - | Done 2026-10-24 - real calls back: everyone free rang, one took it; nobody took it, missed and texted |
| | **Calling on its own** | | | |
| T20 | [The robot places the calls by itself](T20-robot-calls-by-itself.md) | T12-T19 | - | Done 2026-10-24 - a real look found a due lead and called it, once |
| | **Screens** | | | |
| T21 | [The timeline shows the robot calls](T21-timeline-shows-robot-calls.md) | T13 | - | Done 2026-10-24 - seen on real calls: taken, not interested with its answers, nobody took it |
| T22 | [The queue puts a missed "yes" first](T22-queue-puts-missed-yes-first.md) | T15a | - | Done 2026-10-24 - seen in the browser: two "yes" leads nobody took at the top, Wants a call, above a 100-point lead |
| T23 | [Admin > Leads: the Call column](T23-admin-leads-call-column.md) | T4 | - | Done 2026-10-25 - seen in the browser on real calls' leads: voicemail left, not interested, no answer, said yes taken and not |
| T24 | [Admin > Configuration shows the call script](T24-admin-config-call-script.md) | T6 | - | Done 2026-10-25 - seen in the browser: every line in order with its keys and words, and the settings, matching the database |
| | **Finish** | | | |
| T25 | [Everything written down and checked end to end](T25-written-down-and-checked.md) | T0-T24 | - | Done 2026-10-25 - every doc read against the code, the faults fixed; `npm run e2e`, 93 checks, three robot calls |
| T26 | [Real phone, every path, then live](T26-real-phone-then-live.md) | T25 | - | Done 2026-10-30 - every path on a real phone 2026-10-27, calls 66-85; on `main` and live on production 2026-10-30 |
| T27 | [The leads already waiting at the switch-on](T27-leads-already-waiting.md) | T20 | - | Done 2026-10-29 - called too, after new leads, nothing by hand |
| T28 | [A Twilio account problem never uses up a lead's call](T28-twilio-account-problem.md) | T20 | - | Done 2026-10-29 - refused for our account: not the lead's call, and a 15-minute pause |
| T29 | [Five calls at once for each person free](T29-five-calls-per-person.md) | T20 | - | Done 2026-11-02 - a setting, 5, migration 021; one before |

**W1 and W2** were kept in this tracker so there was one list, but they are not
calling work and have no ticket file: W1, day dividers in the agent's conversation
(done 2026-10-18), is a History line in `AGENT-WORKSPACE.md`; W2, a phone call stops
the text questions (done 2026-10-27), is rule 2d and a History line in
`STATE-MACHINE.md`.

## The order

1. T0 first: the first texts the EZ Texting block stopped, resent slowly.
2. Setup, T1 to T3: a laptop can never ring for, or move, production's number;
   the dev number set up.
3. Data and rules with no calls yet, T4 to T8; who can take a call, T9 to T11.
4. The call on the dev number, T12 to T19. T15 was split in three on 2026-10-20,
   before it was started, so each part is one small PR with its own real-call
   checks: everyone free rings (T15a), the lead's own agent first (T15b), and
   letting a ring run out turns the switch off (T15c).
5. The robot calling on its own, T20; the screens, T21 to T24; the finish, T25 and
   T26. T27 and T28 came after T26's real-phone test and went out with it; T29
   after it was live.

## The decisions these tickets build on

The client asked on 2026-10-13 for the leads who never answer the texts to be
called, and agreed the two stages on 2026-10-14; every decision since is in a
Decisions table - who is called, when and how many in `AUTO-CALLS.md`; the words,
the voice, how an answer is read and voicemail in `AUTO-CALL-SCRIPT.md`; who is
rung, the switch and the hold line in `AUTO-CALL-TRANSFER.md`.

## Where the sections are now

The tickets quote `AUTO-CALLS.md`'s sections by the names they had. Each is now:

| Section | Now in |
|---|---|
| "The script" | [`AUTO-CALL-SCRIPT.md`](../AUTO-CALL-SCRIPT.md), "The script" |
| "The whole flow", "When a lead is called", "Leads already waiting", "Traffic", "When Twilio refuses", "How a call is placed", "Where it shows" | [`AUTO-CALLS.md`](../AUTO-CALLS.md), the same names |
| "What is saved" | [`AUTO-CALLS.md`](../AUTO-CALLS.md), "Data" |
| "Who is free - the "Taking calls" switch", "Letting a transfer ring out turns it off" | [`AUTO-CALL-TRANSFER.md`](../AUTO-CALL-TRANSFER.md), "Who is free", "The "Taking calls" switch", "Letting a transfer ring out turns it off" |
| "Understanding an answer", "When the call listens", "How fast", "What the call does after each answer", "On a live call" | [`AUTO-CALL-SCRIPT.md`](../AUTO-CALL-SCRIPT.md), the same names |
| "Voicemail", and its "Not covered" | [`AUTO-CALL-SCRIPT.md`](../AUTO-CALL-SCRIPT.md), "Voicemail", and "Not done" |
| "The transfer", "The hold line", "The next person who comes free gets the waiting lead (T17)", "A lead calling back" | [`AUTO-CALL-TRANSFER.md`](../AUTO-CALL-TRANSFER.md), the same names, without "(T17)" |
| "What the real transfers showed", "What the real calls showed", "The real calls" | the *As built* of T15a-T15c, T16, T17 and T18 |
| "Going live" (T26) | `DEPLOY.md` |
| "Decided with the client" | each of the three docs' "Decisions" |
| "Not in Stage 1" | each of the three docs' "Not done" |
| "Tracker", "The tickets" | this folder |
