# D02 · ARCHITECTURE.md

**Goal:** A new `docs/ARCHITECTURE.md` says, today, what the parts of the system are, how they connect, which outside services it uses, and why it is built this way.

**Why:** The architecture lives in `CLAUDE.md` §2-§4 and `docs/README.md`'s "Architecture", mixed with the original plan (BullMQ, Prisma, a root `Caddyfile`) that was never built (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** Done 2026-11-27 - `docs/ARCHITECTURE.md` in the Architecture sections, checked against the code and compose files; the docs check passes · **Deploy note:** none - documentation only.

## Build

- lead paragraph from `CLAUDE.md` §1, brought up to date: the SMS questions, the queue, browser calls, robot calls with Seri; 50-100 leads a day; no HIPAA;
- **The parts**: Caddy (`caddy/Caddyfile`), api, worker, Redis (runs, unused), Postgres/RDS, the frontend in the Caddy image, the two Dockerfile stages (linking `WORKFLOW.md`/`DEPLOY.md`), the folder map of `backend/src` (folders only - per-file lines go to each area doc's Code section in its own ticket);
- **How they connect**: the diagram from `CLAUDE.md` §2, corrected - no BullMQ, Redis idle, the ConversationRelay WebSocket `/api/ai/relay`, Caddy forwarding only `/api/*`; then a lead's path through the parts in a few lines, linking `LEAD-FLOW.md`;
- **Outside services**: EZ Texting, Twilio (and Deepgram and ElevenLabs through it), OpenAI, AWS (EC2, RDS, CloudWatch, S3);
- **Decisions**: why not Lambda, Supabase, Cognito, Nginx; why RDS; no job queue; plain SQL migrations; a JWT cookie; polling, not push - by Jeel, with dates where known;
- **History**: the planned stack and what was built instead; Redis packages removed 2026-09-28; the Caddyfile `--watch` (review Q11); the two-stage image (review H13).

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

`docs/README.md` (a row), root `README.md` (a link), `CLAUDE.md` (§2 replaced by a pointer - its full shrink is D05).

## Not in this ticket

Folding `LEAD-FLOW.md` in (D25); shortening the rest of CLAUDE.md (D04, D05).

## As built

- `docs/ARCHITECTURE.md` written (about 200 lines): the lead paragraph from `CLAUDE.md` §1, brought up to date; The parts - a table of caddy, api, worker, redis, Postgres and the frontend, the two image stages (linking `DEPLOY.md`, "The images") and the folder map, folders only; How they connect - the corrected diagram, a table of what leaves the server and from which process, a lead's path in four steps linking `LEAD-FLOW.md`; Outside services - EZ Texting, Twilio (Deepgram, ElevenLabs and Google's voice through it), OpenAI's two models, AWS, and backups being RDS's; Decisions - ten rows, with the Lambda, Supabase, Cognito, Caddy and RDS reasons kept in full under the table; History back to the plan.
- Checked against the code: no BullMQ - a plain loop, each cycle under an advisory lock (`db/locks.ts`); no Prisma; `caddy/Caddyfile` with `--watch` and the 10-second hold for a restarting api; Redis started by both compose files and read by nothing; Seri's WebSocket `/api/ai/relay`; and two watchers that run in the api, not the worker (`api/hold-watch.ts`, `api/left-open.ts`), which no architecture text had named.
- Decision dates are inferred: the plan's choices 2026-09-10 (the earliest dated work, `EZTEXTING-API.md`), the as-built ones from `CLAUDE.md`'s "As built, 2026-09-14" and "Paths, as of 2026-09-15"; all By Jeel.
- Merged the reference rewriter's handoff (backups, Redis). The production domain in `caddy/Caddyfile` is not written anywhere.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
