# B20 · EZ Texting: groups and moving a contact

**Goal:** the EZ Texting client can list and create groups and move a contact from one
group to another - proved on the test account before anything relies on it.

**Why:** `backend/src/integrations/ezt-client.ts` can only list contacts and send
texts (survey, 2026-11-27). Two groups per bucket (`BUCKETS.md`, "Finding people")
needs a move. Only the add has been tried (`EZTEXTING-API.md`, "One contact per phone
number", 2026-11-27).

**Depends on:** - · **Size:** S · **Status:** Waits on the client's OK for two groups
· **Deploy note:** none - nothing calls it yet.

## Build

- `ezt-client.ts`, each typed, with the 30-second timeout and Basic auth as today:
  - `listGroups()` - every group (`GET /v1/contact-groups`, all pages): id, name;
  - `createGroup(name)` - `POST /v1/contact-groups`, returns the id;
  - `moveContact(phone, fromGroupId, toGroupId)` - through the **group** endpoints
    (add to the "to" group, then remove from the "from" group), not `POST
    /v1/contacts`, which rewrites the whole contact. Add first: if the remove fails,
    the person is in both groups and the next read retries the move, never losing
    them.
- A 429 from EZ Texting surfaces as its own error type, so a caller can stop for the
  cycle and go on next time.
- `backend/scripts/dev-ezt-groups.ts` (local only): on the test account, with made-up
  555 numbers in new groups named so no poller reads them - create, add, move, read
  back, then delete everything, as on 2026-11-27.

## Done when

- [ ] `src/integrations/ezt-client.test.ts`: each call's method, path and body;
      `moveContact`'s order (add, then remove); a failed remove leaves the error to the
      caller; a 429 is its own error.
- [ ] `dev-ezt-groups.ts` run on the test account, the output in *As built*:
      - the remove endpoint's real method and path, and that it works;
      - the contact's name, email and note unchanged after a move;
      - how many moves a minute pass before a 429, with the reply's headers.

## Tests

The unit tests; the test-account run.

## Docs to update in the same commit

`docs/EZTEXTING-API.md` (a "Groups" section: every call verified, the rate limit),
`docs/BUCKETS.md` (the add and the remove both tried).

## Not in this ticket

Using it (B21, B24).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
