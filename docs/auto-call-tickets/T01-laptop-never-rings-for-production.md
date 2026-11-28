# T1 · A laptop can never ring for production's calls

**Goal:** a browser signed in to a local app is never rung by production's
calls, even on the same Twilio account.

**Depends on:** - · **Size:** - · **Status:** Done 2026-10-16 · **Deploy note:** none
- the prefix is empty there.

## Build

(as built)

- A new optional setting, `TWILIO_IDENTITY_PREFIX` - lower-case letters and
  digits ending in a hyphen, for example `dev-`. Passed to the api and the
  worker by `docker-compose.yml`.
- The browser's name at Twilio becomes `<prefix>agent-<user id>`, in the
  token and in the incoming ring. Production leaves it empty, so its names
  stay `agent-<user id>`.
- Reading a name back (the voice webhook) accepts only this server's prefix,
  so a call from another environment's browser is never taken for one of ours.
- The prefix is a required argument of `identityFor` and
  `agentIdFromIdentity` - no default - so no caller can forget it and quietly
  use production's names.
- A malformed prefix makes the settings incomplete (production refuses to
  start), rather than being used or dropped.

**Files:** `backend/src/core/calls.ts`, `backend/src/twilio-settings.ts`,
`backend/src/integrations/twilio.ts`, `backend/src/api/twilio-webhooks.ts`,
their tests, `docker-compose.yml`, `.env.example`.

## Done when

- [x] Tests: no prefix gives `agent-21`, exactly as today; `dev-` gives
      `dev-agent-21` and reads back as user 21 - in the token, the incoming
      ring and the voice webhook.
- [x] Tests: a dev server refuses `agent-21`, and production refuses
      `dev-agent-21`.
- [x] Tests: a badly formed prefix is named as incomplete; a prefix alone
      does not switch calling on.
- [x] The local `.env` has `TWILIO_IDENTITY_PREFIX=dev-`.

## Docs to update in the same commit

`TWILIO.md`, "What it needs on the Twilio account" and "Settings";
the settings table in `docs/README.md`; `CLAUDE.md` §7.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
