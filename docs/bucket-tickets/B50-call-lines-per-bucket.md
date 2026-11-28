# B50 · The call lines per bucket

**Goal:** each bucket's voicemail message, link text and stop line and words live on
the bucket, read by Seri and by antibiotics' robot script alike - so a bucket with no
robot script still has them.

**Why:** Jeel, 2026-11-27: new buckets have no robot script. Today those lines are
columns of `call_scripts` (`voicemail_body`, `link_text`, `opt_out_body`,
`opt_out_words`, migration 015), and Seri borrows them from the script
(`BUCKETS.md`, "Seri with several buckets"). Without a script they would have nowhere
to live.

**Depends on:** B07, B18 · **Size:** M · **Status:** To do · **Deploy note:** the code
reads columns its migration adds - outside the robot's hours until B02 is in.

## Build

- **Migration:** on `buckets`, `voicemail_body` (with its `{callback_number}`),
  `link_text`, `opt_out_body` and `opt_out_words TEXT[]`, all `NOT NULL`;
  antibiotics' copied from its call script, then the four columns dropped from
  `call_scripts` - a guard first: it stops unless the copies equal them (each fact in
  one place). The checks 015 has on them move with them.
- Every reader moves to the bucket's lines (`grep` the four names):
  - the robot's TwiML and webhooks - the voicemail line (`voicemailLine`,
    `actOnVerdict`), the stop words and line (`/auto/gather`);
  - Seri's relay - `callSettings` (`backend/src/ai/relay-store.ts`), her stop line and
    words;
  - the link text after a call (`sendCallLinkText`, `backend/src/db/lead-texts.ts`);
  - Admin > Configuration.
- `CallScript` (`backend/src/core/call-script.ts`) no longer carries the four; the
  call's bucket supplies them.

## Done when

- [ ] `scripts/call-lines-upgrade-check.ts` (B03): antibiotics' four lines copied word
      for word; the columns gone from `call_scripts`; the migration stops when a copy
      differs.
- [ ] `scripts/call-script-live-check.ts` and `scripts/lead-texts-live-check.ts`: the
      lines read from the bucket; the guards hold.
- [ ] `src/api/__tests__/auto-call-webhooks.test.ts`, `src/ai/relay.test.ts`: the
      voicemail line, the stop line and words come from the call's bucket.
- [ ] `npm run e2e` passes - antibiotics' words unchanged.

## Tests

The upgrade check, the live checks, the unit tests, the e2e.

## Docs to update in the same commit

`docs/AUTO-CALL-SCRIPT.md` ("The script", "Voicemail"), `docs/AI-AGENT.md`,
`docs/SCHEMA.md`, `docs/WORKFLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

Each new bucket's own lines - written by its migration (B47, B49).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
