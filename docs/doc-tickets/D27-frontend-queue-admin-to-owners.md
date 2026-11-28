# D27 · FRONTEND.md: the queue and admin sections to their owners

**Goal:** What `FRONTEND.md` says about the queue and the admin screens lives in `QUEUE.md`, `ADMIN.md` and `ADMIN-LEADS.md`; `FRONTEND.md` takes back the polling hook and the on-screen lock from `QUEUE.md`.

**Why:** Each fact in one place (audit, 2026-11-27).

**Depends on:** D17, D18, D19 · **Size:** S · **Status:** Done 2026-11-27 - queue, Overview, Configuration's Seri card, Admin > Leads and Agents screens handed off; the polling hook and the on-screen lock written into FRONTEND.md from `usePolling.ts` and `lib/lock.ts` · **Deploy note:** none - documentation only.

## Build

- the queue section to `QUEUE.md`; the admin sections to `ADMIN.md`/`ADMIN-LEADS.md`; `usePolling` and the lock from `QUEUE.md` into `FRONTEND.md`.

## Done when

- [ ] the doc's sections are its type's, in the type's order (`docs/DOCS.md`)
- [ ] no dated note, "As built" or "until" aside left in the body - each is a line in History
- [ ] every fact another doc owns is a link, not a copy
- [ ] every file, function, setting and route it names exists (`grep`)
- [ ] every link resolves, and every code comment that quotes a moved or renamed section is updated
- [ ] nothing lost: each removed sentence is either still true somewhere, or in History

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

those four docs.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

The queue screen went to `QUEUE.md`, Overview and the Seri card to `ADMIN.md`, the tabs and redesign history to `ADMIN-LEADS.md`, Admin > Agents to `AUTH.md`, as handoffs. `FRONTEND.md` owns "The polling hook", "The one-agent lock on screen" and "What the button offers", the names kept as headings. ADMIN-LEADS's rewrite had already fixed its stale "DNC list keeps its view in memory" line.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
