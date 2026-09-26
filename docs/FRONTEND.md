# Frontend

The React app: what exists, how the screens fetch, and the decisions that are
not obvious from the code. `DESIGN-PROMPT.md` is the brief - what the screens
should be. This is what they are.

React 18, Vite 4, React Router 6, zustand, plain CSS with design tokens. No UI
framework: the components in `src/components` are the whole kit.

**Built 2026-09-26** - Phase 3 tasks 14-25, the frontend half. Every screen in
the brief now exists except calling, which is Phase 4.

## The screens

| Route | Screen | Doc |
|---|---|---|
| `/queue` | Priority queue | `QUEUE.md`, `DESIGN-PROMPT.md` 2 |
| `/leads/:id` | Agent workspace | `AGENT-WORKSPACE.md`, `DESIGN-PROMPT.md` 3 |
| `/leads/:id/timeline` | Lead timeline, read-only | `DESIGN-PROMPT.md` 4 |
| `/callbacks` | My callbacks | `AGENT-WORKSPACE.md`, `DESIGN-PROMPT.md` 5 |
| `/admin/overview` | Overview | `ADMIN.md`, `DESIGN-PROMPT.md` 6a |
| `/admin/leads` | Every lead, replied or not | `ADMIN-LEADS.md` |
| `/admin/agents` | Agent accounts | `AUTH.md` |
| `/admin/config` | Configuration, read-only | `ADMIN.md`, `DESIGN-PROMPT.md` 6b/6c |
| `/admin/dnc` | Do-not-call list, read-only | `ADMIN.md`, `DESIGN-PROMPT.md` 6e |

Agents land on `/queue`; `/admin` lands on Overview. The admin section is behind
`RequireRole`, and every admin endpoint refuses an agent independently - the
guard on the screen is convenience, not security.

## Fetching

**Every live screen polls through `api/usePolling.ts`.** One hook, 5 seconds,
one place - so a real push can replace it later without touching a screen.
`QUEUE.md`, "The polling hook", has the full contract and why each guarantee is
tested rather than eyeballed.

The short version:

```ts
const fetcher = useCallback(() => listQueue({ tier, source }), [tier, source]);
const { data, loading, error, refresh, updatedAt } = usePolling(fetcher);
```

The fetcher must be wrapped in `useCallback`. A new fetcher means new filters,
which clears the data and shows a spinner; a fetcher rebuilt every render would
clear the screen every render.

**A failed tick keeps the last good data** and raises a banner over it. A
dropped connection should not blank a table an agent is reading.

**Two fetches on one screen is fine.** The workspace polls the lead card and the
timeline separately, and Overview polls the overview and the health check
separately. Both are cheap, and keeping them apart means a slow one cannot hold
up the other.

## Types mirror the backend

`api/leads.ts`, `api/workspace.ts` and `api/admin.ts` hold interfaces that
mirror backend ones, each naming the file it mirrors. They are hand-written, so
they can drift - and did:

- `Note` carries `author`, not `agentId`/`agentName`.
- `CallbackListRow`'s lead has no `id` and no `score`, and does have `source`.

Both were wrong until the screens were run against the real endpoints, and both
would have rendered blanks rather than errors. **Check a new type against its
backend counterpart by calling the endpoint**, not by reading the interface.

## Decisions worth knowing

**No STATE column in the queue.** The mockup has one; EZ Texting sends no state
with a contact (`EZTEXTING-API.md`), so every row would read "-" forever. Left
out rather than given permanent space in a table the brief asks to keep dense.
Decided 2026-09-26. It goes back in if the partner ever sends state.

**Age ticks on its own timer, not on the poll.** Once a second, from
`lib/format.ts`. A number that only moved when the data refreshed would be wrong
for up to five seconds at a time, and age is the queue's signal for how long
someone has waited. Amber past 5 minutes, red past 15 for HOT - tighter for HOT
because a HOT lead asked to be called now.

**Clicking a queue row claims the lead, then opens it.** Claiming at the moment
of intent means a row cannot sit locked because someone glanced at it. A 409
shows the holder's name and refreshes, so the row mutes itself. Leaving the
workspace releases the claim.

**The lock is decided in `lib/lock.ts`.** The server enforces it; the screen has
to decide which rows to mute before anyone clicks. Not locked: nobody holds it,
you hold it, or you are a superadmin. `QUEUE.md`, "The one-agent lock on
screen", has the reasoning and the known weakness - the holder is matched by
name because the endpoint returns no id.

**One Save, three writes.** The workspace right column posts a note, a callback
and a disposition to three separate endpoints. Each is append-only, so a partial
failure leaves whatever succeeded; the panel names the part that failed rather
than claiming the whole save went wrong.

**Save & next** saves, releases, and opens the top unlocked lead using the same
`lockHolder` rule the queue uses - so "next" means what the agent would have
clicked. A failed save stops the move: losing a note on the way to the next lead
is worse than an extra click.

**DNC asks twice,** and the dialog says the block can only be lifted by the lead
texting START. The API refuses the value without `confirmDnc: true` regardless.

**The SMS warning is shown before the first send,** because sending stops the
automated questions for good (`STATE-MACHINE.md` rule 2b) and cannot be undone.
Once the conversation has already been taken over the warning goes away. On a
DNC lead there is no compose box at all.

**The SMS templates are hardcoded,** unlike the automated copy in `settings`.
They are an agent's own words mid-conversation, so a mistyped one costs a single
awkward message rather than reshaping every lead's experience. They move to
`settings` if the client wants to edit them.

**Admin pages say they are read-only.** Jeel's decision of 2026-09-23 is a
decision, not a missing feature, so the screens explain it rather than leaving a
superadmin hunting for a Save button.

**Known gaps are shown, not hidden.** The timeline sidebar's Consent ref and
duplicate check have no data behind them and say so; the Overview's call figures
are dimmed with a note. Leaving them off would make someone wonder whether the
page forgot them.

## Tests

`npm test` in `frontend/`. Vitest with jsdom, 69 tests.

Logic only, by agreement: the polling hook's race guard, the formatting and age
thresholds, the lock rule, the timeline's wording, and the timeline page's
summary derivation. Not every button - a screen is easy to judge by eye, and a
dropped response or an off-by-one age threshold is not.

```bash
cd frontend
npm test          # once
npm run test:watch
```

## Running it

`docs/README.md` has the full local setup. For the frontend alone:

```bash
cd frontend
npm install
npm run dev       # :5173, proxying /api to the API on :3000
npm run build     # tsc then vite build, into dist/
```

Production serves `dist/` from the `caddy` service, built by
`frontend/Dockerfile`. Caddy forwards only `/api/*` to the API, which is why
every route lives under `/api`.

## Not built

- **Calling.** Phase 4. The Call button is present and disabled, and call
  entries render in the timeline, so the screens keep their shape when Twilio
  lands.
- **Live push.** Polling stands in for it, deliberately - see above.
- **Export CSV** on the DNC list. In the brief, and it hands a file of phone
  numbers to a browser, so it needs Jeel to ask for it.
- **Previous-lead history** on the timeline. Repeat-lead handling is a future
  item (CLAUDE.md §10), so there is never an earlier lead to show.
