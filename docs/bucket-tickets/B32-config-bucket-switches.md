# B32 · Admin > Configuration: switches per bucket

**Goal:** a superadmin switches a bucket's texts and robot calls on and off from Admin
> Configuration, confirmed, recorded - as Seri's switch is.

**Why:** a new bucket starts with everything off (`BUCKETS.md`); B26 and B34 add the
switches with a command. The page gets the button, like Seri's (2026-11-24).

**Depends on:** B26, B34 · **Size:** M · **Status:** Waits on the client (via B26) ·
**Deploy note:** none.

## Build

- `backend/src/api/admin/config.ts`, superadmin only:
  `POST /buckets/:key/texts` and `POST /buckets/:key/robot-calls` with `{ on }` - 400
  `invalid_body`; 404 for an unknown bucket; 409 `no_group` (texts, groups not set) or
  `no_script` (robot calls, no active script); otherwise `switchTexts` /
  `switchRobotCalls` with `via: 'website'` and the user.
- `frontend/src/api/admin.ts`: the two calls.
- `frontend/src/pages/admin/ConfigPage.tsx`: a "Texts" card on the Texts tab and a
  "Robot calls" card on the Calls tab, beside Seri's - state, a one-line note, Switch
  on / Switch off behind `ConfirmDialog`. The wording from a pure function, as
  `seriState` does, tested on its own.

## Done when

- [ ] `src/api/__tests__/admin-screens.test.ts`: every status above; the switch called
      with the user.
- [ ] Frontend tests: each card's state wording; confirm then switch; Cancel; refused
      states.
- [ ] `scripts/activity-live-check.ts`: `bucket.switched` from the website carries the
      actor.

## Tests

As above.

## Docs to update in the same commit

`docs/ADMIN.md` (Admin's controls; Decisions - the read-only rule's exceptions now also these two), `docs/AUDIT.md`, `docs/LOGGING.md`,
`docs/FRONTEND.md`, `docs/BUCKETS.md`.

## Not in this ticket

Editing a bucket (Part 3).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
