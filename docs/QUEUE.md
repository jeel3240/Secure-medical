# Priority Queue API

`GET /api/leads` - the list agents work down, best lead first. Any signed-in
user; a superadmin sees the same thing.

Screen: `DESIGN-PROMPT.md` section 2. Code: `backend/src/api/leads.ts` (route),
`backend/src/db/queue.ts` (the query), `backend/src/core/queue-tags.ts` (the
tag). Flow rules it depends on: `STATE-MACHINE.md`.

## Who is in it

Responders only. Someone the partner sent who never texted back is not an
agent's problem, and burying HOT leads under them is the reason this list and
Admin > Leads are separate pages - `ADMIN-LEADS.md`.

A lead is in the queue when all of these hold:

| Rule | Why |
|---|---|
| Score above 0 | Scoring starts at the first reply, so a score is the mark of a responder. Nothing else on the row proves a reply as cheaply. |
| No live `dnc_list` row for the phone | An opt-out is absolute. A row released by START (`released_at` set) does not count - `STATE-MACHINE.md`, "Opting back in". |
| Newest conversation is `open`, `completed` or `review` | `suppressed` is an opt-out from the conversation's side. |
| …or `expired` **and** the lead has an unread inbound | Expired leads leave the queue - Jeel, 2026-09-19 - but a lead who texts us afterwards comes back until an agent reads it. |

Only the newest conversation counts. Older ones are history and are not
consulted, so a lead who completed a second conversation is not dragged back by
the first one having expired.

## The order

`score DESC`, then the most recently received, then id.

Score first is the point of the screen. Freshest next, because speed to contact
is what the score is for - `DESIGN-PROMPT.md` section 2, "sorted by score then
freshness". Id last so the order never wobbles between two identical rows.

## The tag

One tag per row, computed, never stored, so it stays true as calls and
callbacks happen. The API returns what is true and the screen words it: `{ kind:
'in_progress', agentName: 'Michael' }` becomes "In progress - Michael".

Several can apply at once, so they are ranked by what an agent most needs to
know:

| # | `kind` | Shown when | Carries |
|---|---|---|---|
| 1 | `in_progress` | An **active** agent holds the lead | `agentName` |
| 2 | `callback` | A callback is booked and not done | `callbackAt` - the soonest |
| 3 | `inbound_reply` | The lead has texted and nobody has read it | |
| 4 | `needs_review` | Conversation `review`: replies we could not read | |
| 5 | `stalled` | Conversation `open`, one or two answers in | `step` - the number of answers |
| 6 | `attempted` | Calls have been made and none connected | `attempts` |
| 7 | `new` | Nothing has happened yet | |

Two things worth knowing:

- **`stalled` counts answers, not the pending question.** `step: 2` is a lead
  who answered Q1 and Q2 and went quiet, and the screen writes it "Stalled at
  Q2". `step` is therefore only ever 1 or 2 - a third answer completes the
  conversation. It is never set for an `expired` conversation, which is closed
  rather than waiting: `STATE-MACHINE.md`, "Expiry".
- **A claim by a deactivated agent is ignored.** `assigned_to` is joined through
  `users.is_active`, so deactivating an agent hands their held leads back to the
  floor instead of parking them behind a name nobody can sign in as.

`Seen before, stopped at Qn` is in the mockup and is not built: repeat leads are
a future item, CLAUDE.md §10.

## Filters

`GET /api/leads?tier=&source=&since=&q=&limit=`

| Parameter | Takes | Rejects with |
|---|---|---|
| `tier` | `HOT`, `WARM`, `LOW`, comma-separated, any case | 400 `invalid_tier` |
| `source` | Partner codes, comma-separated | — |
| `since` | `1h`, `24h`, `7d`, `30d`, `all` | 400 `invalid_since` |
| `q` | Name, or phone in any punctuation | — |
| `limit` | Whole number above 0; clamped to 500, default 100 | 400 `invalid_limit` |

A bad filter is refused rather than quietly ignored, so a typo in a link shows
up as an error instead of the wrong queue.

`q` matches first and last name, or the phone with punctuation stripped, so
`(602) 620-3572` finds `+16026203572`. What is typed is escaped before it
reaches `LIKE`: a `%` in the search box is the character, not a wildcard.

## The response

```jsonc
{
  "leads": [ { "id": 7, "phone": "+1…", "firstName": "…", "lastName": "…",
               "source": "CORE-G-27", "receivedAt": "…", "score": 90,
               "tier": "HOT", "q1": "3", "q2": "1", "q3": "1",
               "conversationStatus": "completed", "tag": { "kind": "new" } } ],
  "counts":  { "all": 12, "HOT": 4, "WARM": 5, "LOW": 3 },
  "sources": ["CORE-G-27", "CORE-G-31"],
  "total":   12,
  "limit":   100
}
```

`counts` feeds the header pills, which are also the tier filter, so it is
counted **without** the tier filter - otherwise picking HOT would zero the other
two and the agent would lose sight of what is waiting. `sources` is the dropdown
and is counted without the source filter, for the same reason: picking one
source would otherwise leave it alone in the list with no way back. Every other
filter applies to both.

`total` is how many matched everything asked for, so the screen can say when the
limit cut the list short. It costs no extra query: the tier counts already carry
every other filter, so the selected tiers add up to it.

`receivedAt` is `ezt_added_at`, falling back to `created_at` - when the lead
reached us, which is what the ticking AGE column counts from.

`q1`-`q3` are the raw choices, `"1"`, `"2"`, `"3"`. The screen maps them to the
INTEREST / TIMING / PREFERENCE words, because the wording belongs to the
question copy in `settings`, which a superadmin can edit.

## What this does not cover

- **The STATE column in the mockup is not returned.** EZ Texting sends no state
  with a contact - `EZTEXTING-API.md` - so there is nothing to return. It needs
  a source for that field before the column can be built.
- **No live updates yet.** The screen is specified as updating without a
  refresh, and this is a plain request. *(2026-09-23, Jeel: new leads appear by
  themselves. Done by polling this endpoint every 5 seconds, the way
  `ADMIN-LEADS.md` already does - at 50-100 leads a day an agent cannot tell it
  from a push, and it needs nothing new on the server. The fetching goes in one
  place so a real push can replace it later without touching the screens.)*
  **Built 2026-09-26** as `frontend/src/api/usePolling.ts`, Phase 3 task 14 -
  see "The polling hook" below.
- **Claiming is written elsewhere.** `assigned_to` is read here, never written.
  `POST /api/leads/:id/claim` and `/release` do that - Phase 3 task 2,
  `AGENT-WORKSPACE.md`.
- **`has_unread_inbound` is cleared by `POST /api/leads/:id/read`** - Phase 3
  task 3. Until it existed nothing unset the flag, so an expired lead who texted
  back stayed in the queue however often an agent read the message. Proved
  against a real database: such a lead leaves the queue once read, while a lead
  whose conversation is still open stays, because the flag was never what was
  keeping it there. `STATE-MACHINE.md`, "Expiry".
- **No paging.** `limit` truncates and `total` says by how much; at 50-100 leads
  a day the default of 100 holds several days of queue. Page when it does not.

## Proving it

The tag rules and the route have unit tests (`queue-tags.test.ts`,
`api/__tests__/queue.test.ts`, 41 tests). Neither touches the SQL, which is
where most of the rules above actually live, so
`backend/scripts/queue-live-check.ts` seeds one lead per case in a scratch
database and asserts what comes back - inclusion, exclusion, order, every tag,
each filter, the counts. The header of that file says how to run it. Last run
2026-09-22: 36 checks, all passing.

## The polling hook

`frontend/src/api/usePolling.ts`. Every live screen fetches through it: the
queue, the workspace, the timeline, My Callbacks and the three admin pages.

```ts
const fetcher = useCallback(() => listQueue({ tier, source, since, q }), [tier, source, since, q]);
const { data, loading, error, refresh, updatedAt } = usePolling(fetcher);
```

**One place, so a push can replace it.** `POLL_MS` is 5000 and the interval
lives here alone. Swapping polling for websockets later means rewriting this
file and nothing else. `admin/LeadsPage.tsx` had its own copy of the interval
before this task and now uses the hook; copying it to eleven more screens is how
a codebase ends up with five different refresh behaviours.

**What it guarantees, and why each one is tested rather than eyeballed:**

| Behaviour | Why it matters |
|---|---|
| `data` survives a tick | The table must not blank out every five seconds |
| `loading` is true only when there is nothing to show | A spinner on every tick makes the screen flicker |
| An error keeps the last good `data` | A dropped connection shows a banner over stale rows, not a blank page - the design brief's "Live updates paused" |
| A stale response is discarded | A slow request from a filter the agent has already changed must not overwrite the current view |
| The timer stops on unmount | Otherwise it polls forever and sets state on a dead component |
| `refresh()` fetches now | So a claim or a note appears at once instead of up to 5s later |

**The fetcher must be stable** - wrapped in `useCallback` with the filters as
dependencies. When it changes that counts as a new view: the spinner returns and
the old rows are cleared, because rows fetched under the old filter do not
belong under the new one. A fetcher rebuilt on every render would clear the data
on every render.

`frontend/src/api/usePolling.test.ts` covers all six rows above. None of them is
visible in a browser, which is why they are tested at all - the screens
themselves are judged by eye.
