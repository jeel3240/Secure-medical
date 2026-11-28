# T26 · Real phone, every path, then live

**Goal:** every path has been heard on a real phone, and production is
switched on.

**Depends on:** T25 · **Size:** - · **Status:** Done 2026-10-30 - every path on a real
phone 2026-10-27, calls 66-85; on `main` and live on production 2026-10-30 ·
**Deploy note:** switched on at the end, by Jeel.

## Build

- On the dev number, to Jeel's phone, with two browsers: yes taken; yes
  nobody; yes on hold then taken; no -> link; no -> no; stop; silence twice;
  keys; voicemail; calling back after the voicemail.
- The link text checked on a real phone: https://www.edrugstore.com/anti-ez.
- Deploy with `AUTO_CALLS` off; migrations run; then Jeel sets `AUTO_CALLS=on`
  and watches the first calls.

**Going live - Jeel's steps**, and how to stop: moved to `DEPLOY.md` on
2026-11-27, where they are kept up to date - the steps as they were run are
under *As built*.

## Done when

- [x] Every path above heard and saved correctly - 2026-10-27, on the dev
      number to Jeel's phone, two browsers (Jeel, nora), calls 66 to 85:

      | Case | Call | Heard / done | Saved |
      |---|---|---|---|
      | Yes, taken | 67 | "Yes" 0.70, both rang, nora took it | `transferred`, lead nora's |
      | Yes, nobody took it | 68 | "Yes" 0.78, both rang out | `transfer_missed`, both switched off, queue Wants a call |
      | Yes, on hold, then taken | 70 | "Yes" 0.86, nora on a call: hold; the call ended, nora rung from hold | `transferred`, lead nora's |
      | No, then the link | 71 | "No" 0.73, "Yes" 0.86 | `link_sent`, text received |
      | No, then no - keys | 72 | 2, then 2 | `not_interested`, no text |
      | Silence twice | 73 | nothing, twice | `no_response` |
      | Stop | 74 | "Don't call me." 0.98 | `opted_out`, blocked, conversation ended; the next call refused |
      | Voicemail | 75 | the beep, the whole message on Jeel's voicemail | `voicemail_left`, `machine` |
      | Calling back | 76 | both rang (nobody's lead), Jeel took it | `answered`, lead Jeel's |
      | **The robot by itself** | 77 | one look, as the worker's: a lead texted 61 minutes before, room 2, due 1, called; "No", "No"; the next look found nobody due | `not_interested` |
      | Not understood, then a key | 78 | "Maybe" 0.75, asked again, 2, then 2 | `not_interested` |
      | Hung up mid-question | 79 | | `hung_up`, no answer kept |
      | Declined | 80 | the iPhone sent it to voicemail: the message left | `voicemail_left` (a decline that gives busy is `unanswered` - call 56) |
      | Yes, nobody taking calls | 81 | "Yes" 0.92, nothing rang | `transfer_missed`, `nobody_free` |
      | Yes, the lead's own agent first | 82 | "Yes" 0.87, Jeel rung alone, let it ring out, then nora | `transferred` to nora, taken from Jeel; Jeel switched off |
      | On hold, nobody coming | 84 | nora on a call: hold; nora switched off - the busy line 18 seconds later | `transfer_missed` |
      | Calling back the lead's agent | 85 | only Jeel rang, not nora; not answered | missed, the missed-call text, a callback for Jeel |

      Found on the way, nothing changed: a browser with no microphone
      cannot accept (call 66 - nora's window had none; the lead was picked up
      for nora before the sound failed, and Jeel's window then took the call
      and the lead) - a headset before the ring, and a reload, as before; a
      spoken "No" heard at 0.00 confidence is taken as no figure, not doubt
      (T7), so it counted (call 77); and the "pretend call" that put nora
      on a call was a `calls` row of nora's, by hand, on the local database.
- [x] The first real robot calls on production, seen on the timeline and
      Admin > Leads - live from 2026-10-30; about 200 robot calls there on
      2026-11-02 (T29).

## As built

Every path heard on 2026-10-27 (the table above); `dev` merged into `main` and
deployed on 2026-10-30, then switched on. The steps as they were run, before
they moved to `DEPLOY.md`:

1. Merge `dev` into `main` and deploy as `WORKFLOW.md` says, **with
   `AUTO_CALLS` unset**; `npm run migrate` runs 014 to 020 - run it straight
   after the `up`: until 017 has run, the new code cannot read the `users`
   table, so signing in and every page fail. Calling does not change: the switch is hidden, `/auto/*` answers 404, the worker places
   nothing. Admin > Configuration > Calls reads **Off** and shows the script.
   What does show at once: day dividers in the conversation (W1), a text from
   a lead who has rung us going to a person (W2), Admin > Leads' Call column
   (empty), and Admin > Configuration's three tabs.
2. Add `AUTO_CALLS=on` to the server's `.env`, then recreate the api and the
   worker: `docker compose -f docker-compose.yml -f docker-compose.prod.yml
   up -d api worker`. Not `docker compose restart`: it keeps the old
   environment, so calls stay off. Nothing else: calling's seven settings are
   already there, and on the server every number may be rung
   (`AUTO_CALL_TEST_NUMBERS` is for laptops only).
3. Check Admin > Configuration > Calls: **On**, the call-back number
   production's (480) 470-8259, 11:00 AM - 5:00 PM, Monday to Friday. That
   screen shows the api's setting only; for the worker, its `worker.started`
   log line says `autoCalls` `on` (CloudWatch, stream `worker` -
   `WORKFLOW.md`).
4. Agents reload the app, then switch **Taking calls** on - the switch shows
   only on a page loaded after the switch-on. With nobody on, the robot calls
   nobody.
5. The first calls go out as soon as someone is free, inside 11-5 Arizona
   time, Monday to Friday: the leads already waiting for a reply are due at
   once, oldest first (T27, "Leads already waiting"); a lead that arrives
   after the switch-on is called an hour after its text, ahead of them. Watch
   them on the leads' timelines and Admin > Leads' Call column.

To stop: take `AUTO_CALLS` out of `.env` and run the same `up -d api
worker`, outside the calling hours - a call still going loses its webhooks
(404) the moment the api restarts without it.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
