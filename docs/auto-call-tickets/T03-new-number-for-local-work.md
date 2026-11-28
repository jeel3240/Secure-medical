# T3 · Set up the new number for local work

**Goal:** calls can be made and received locally on the new number, never on
(480) 470-8259.

**Depends on:** T1, T2 · **Size:** - · **Status:** Done 2026-10-17 - a real call each
way on the dev number · **Deploy note:** none.

## Build

- **Done 2026-10-15:** the new number is **(480) 530-8582** (added by the
  client on 2026-10-14, voice and SMS, pointing nowhere). A TwiML App
  "secure-medical-calling-dev" was created, pointing nowhere. The local
  `.env` holds the new number and that app, with `PUBLIC_URL` empty - so
  calling stays off on the laptop - and production's number and app are no
  longer in it. The account id, token and API key are shared with production.
- **After T1:** `TWILIO_IDENTITY_PREFIX=dev-` in the local `.env`.
- **Done 2026-10-17:** checked the local `.env` held only the dev number, app
  and prefix; started a tunnel and set it as `PUBLIC_URL`; started the api
  alone - not the worker, so nothing polled EZ Texting or asked the questions
  (the api still sends the missed-call text: a third, unanswered test call
  texted Jeel's phone - `TWILIO.md`);
  `dev:twilio:configure -- --dry-run`, then for real: the dev app and the dev
  number now point at the tunnel. A local test lead with Jeel's phone (the
  local database only).

**Files:** none in the code.

## Done when

- [x] A real call from the local app reaches Jeel's phone, showing the new
      number - 2026-10-17, rang from (480) 530-8582; not picked up, saved
      `no_answer`, which is right.
- [x] A real call to the new number rings the local browser - only it, as
      `dev-agent-16`; answered, 6 seconds, recording saved.
- [x] Production untouched - its number and TwiML App read back on Twilio
      before and after, still pointing at production's domain. (Checked on
      Twilio directly rather than on Admin > Overview, whose Calling check
      reads the same two settings.)

## Docs to update in the same commit

`TWILIO.md` - local calling is allowed on the dev number only, how to
set it up, and these two calls.

## As built

The setup and the two calls are recorded under *Build* and *Done when*.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
