# D31 · DESIGN-PROMPT.md restored

**Goal:** `DESIGN-PROMPT.md` reads as the brief was written, with one note at the top.

**Why:** `DOCS.md`, "Brief": kept as it was, not updated (audit, 2026-11-27).

**Depends on:** D30 · **Size:** S · **Status:** Done 2026-11-27 - `git diff bdb51be -- docs/DESIGN-PROMPT.md` shows only the seven lines of the top note · **Deploy note:** none - documentation only.

## Build

- the text restored from git - the 2026-09-14 version with section 6g (`bdb51be`), the original being `7925be4` - checked that nothing in it is lost that D30 did not carry; the note at the top: what this is, and that `FRONTEND.md` and the area docs say what was built.

## Done when

- [ ] `git diff` against `bdb51be` shows only the top note;
- [ ] every note removed was carried by D30 - the list in *As built*.

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

`DESIGN-PROMPT.md` is the 2026-09-14 brief from `bdb51be` with one note under the title: the original brief, kept as written, and `FRONTEND.md` and the screens' docs say what was built. Every note removed was carried by D30: section 1's role (ADMIN); the typography (FRONTEND-STYLE); the app bar, toasts and shortcuts overlay (Differences); section 2's membership, API, STATE, tiers, source, Answers, Waiting, Stalled, Seen before, the statuses, the button, the row click, row animation, unread dot and skeleton (QUEUE, FRONTEND, Differences); section 3's redesign, chips, header, Call, draft, Assign to, outcomes, Save & next and guard (AGENT-WORKSPACE, CALLBACKS, TWILIO, Differences); section 4's header and duplicate check (TIMELINE, FRONTEND); section 5 (CALLBACKS); section 6's sub-menu, 6a-6g and the 6c "Update" bullet (ADMIN, ADMIN-LEADS, AUTH, STATE-MACHINE, Differences); the interaction notes (Differences).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
