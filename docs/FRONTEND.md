# Frontend

The React app agents and the superadmin use: its screens and routes, the app
shell, how every screen fetches, the one-agent lock as the screen sees it, and the
types it shares with the backend. The code is `frontend/src/`. What each screen
shows is its area's doc - the table below; the design system is
`FRONTEND-STYLE.md`; `DESIGN-PROMPT.md` is the brief it was built from, and
"Differences from the brief" below says where it went another way.

## How it works

### The stack

React 18, Vite 4, React Router 6, zustand for the two app-wide stores (the
session, `auth/store.ts`, and the incoming call, `lib/incoming-call.ts`), axios
for requests (`api/client.ts`, every one under `/api`), and `@twilio/voice-sdk`
for calling. Plain CSS on design tokens - no UI framework; the components in
`src/components` are the whole kit (`FRONTEND-STYLE.md`).

### The screens

| Route | Screen | Doc |
|---|---|---|
| `/login`, `/change-password` | Sign in, and the forced first password change | `AUTH.md` |
| `/queue` | The priority queue - where an agent lands | `QUEUE.md` |
| `/leads/:id` | The agent workspace, with the Call button and the call bar | `AGENT-WORKSPACE.md`, `TWILIO.md` |
| `/leads/:id/timeline` | The lead timeline, read-only, with its summary sidebar | `TIMELINE.md` |
| `/callbacks` | My Callbacks | `CALLBACKS.md` |
| `/admin/overview` | Overview - where `/admin` lands | `ADMIN.md` |
| `/admin/leads` | Every lead, replied or not | `ADMIN-LEADS.md` |
| `/admin/agents` | Agent accounts | `AUTH.md` |
| `/admin/config` | Configuration: Texts, Scoring and Calls, the tab in the address (`?tab=`) | `ADMIN.md` |
| `/admin/dnc` | The do-not-call list | `ADMIN.md` |
| every signed-in screen | The incoming-call card and the "Taking calls" switch | `INCOMING-CALLS.md`, `AUTO-CALL-TRANSFER.md` |

`App.tsx` holds the routes. `/` goes to `/queue`, an unknown address to `/`.
`RequireAuth` (`auth/guards.tsx`) sends a signed-out visitor to `/login` and
someone on a temporary password to `/change-password`; `RequireRole` sends an
agent away from `/admin`. Every admin endpoint refuses an agent on its own - the
guard on the screen is so an agent never sees a page that would fail, not the
security (`AUTH.md`).

`/leads/:id` is `LeadWorkspaceRoute`, which keys `WorkspacePage` by the lead's
id: going from one lead's page to another - Accept, or a missed call's Call
back - builds the page afresh, so nothing of the first lead's - its after-call
note box above all - carries over to the second.

### The app shell

`layout/AppShell.tsx`: the navy app bar - the product mark, Queue, My
Callbacks and, for a superadmin, Admin; on the right the "Taking calls" switch
(shown only with automated calls on, `AUTO-CALL-TRANSFER.md`, "The \"Taking calls\" switch") and the
user menu, `layout/UserMenu.tsx`, with the person's name and role. Under it the
page, centred and capped at 1440px. Mounted once beside the page, so it is on
every screen, the incoming-call card (`layout/IncomingCall.tsx`,
`INCOMING-CALLS.md`). Admin pages sit in `pages/admin/AdminLayout.tsx`, with its
side menu: Overview, Leads, Agents, Configuration, DNC list.

`main.tsx` loads the tokens and the stylesheets and arms the ringtone, so the
first click anywhere - the sign-in button included - lets an incoming call ring
(`INCOMING-CALLS.md`).

### The polling hook

`api/usePolling.ts`. Every live screen fetches through it: the queue, the
workspace, the timeline, My Callbacks and four admin pages (Leads, Overview,
Configuration, DNC). Admin > Agents loads once and does not poll.

```ts
const fetcher = useCallback(() => listQueue({ tier, source, since, q }), [tier, source, since, q]);
const { data, loading, error, refresh, updatedAt, switching } = usePolling(fetcher, { keepPreviousData: true });
```

**One place, so a push can replace it.** `POLL_MS` is 5000 and the interval lives
here alone; swapping polling for websockets means rewriting this file and no
screen. Copying a `setInterval` to every screen is how a codebase ends up with
five different refresh behaviours. **Refreshes do not pile up:** a screen asks
again five seconds after the last answer arrived, not on a fixed timer, so a slow
server never has requests piling up on it, each holding a database connection.

| What it guarantees | Why |
|---|---|
| `data` survives a tick | A table must not blank out every five seconds |
| `loading` is true only when there is nothing to show | A spinner on every tick makes the screen flicker |
| An error keeps the last good `data` | A dropped connection shows a banner over the last rows - "Live updates paused" - not a blank page |
| A stale response is discarded | A slow answer for a filter the agent has already changed must not overwrite the view |
| The next request waits for the last answer | Never more than one request in flight from a screen |
| The timer stops on unmount | Otherwise it polls forever and sets state on a dead component |
| `refresh()` fetches now | A claim or a note appears at once, not up to five seconds later |
| `keepPreviousData` keeps the old data through a switch | Opt-in: the queue's tier and search, Admin > Leads' status, the DNC list's state, My Callbacks' tab and Overview's period. The old rows stay while `switching` is true, faded and unclickable (`.is-switching`), so nobody acts on a row from the view they just left; only the table fades, so the switcher stays sharp |
| `enabled: false` fetches nothing | For a screen not ready yet - a lead id that is not a number |

`usePolling.test.ts` covers every row. None of them is visible in a browser,
which is why they are tested at all - the screens themselves are judged by eye.

**The fetcher must be stable** - wrapped in `useCallback` with the filters as its
dependencies. A new fetcher is a new view: without `keepPreviousData` the spinner
returns and the old rows are cleared, because rows fetched under the old filter
do not belong under the new one. A fetcher rebuilt every render would clear the
screen every render.

**Two fetches on one screen is fine.** The workspace and the timeline page poll
the lead card and the timeline separately, and Overview the overview and the
health check: both are cheap, and kept apart a slow one cannot hold up the other.

### The one-agent lock on screen

`lib/lock.ts`. The lock is enforced on the server - `db/claims.ts`,
`AGENT-WORKSPACE.md`, "Claim and release" - and no screen is trusted with it, but
the queue has to decide which rows to mute before anyone clicks. A row is locked
when its tag is `working` and someone else holds it. It is not locked when:

| Case | Why |
|---|---|
| Nobody holds it | The usual case |
| You hold it | Reopening your own claim is the normal way back into a lead; locking you out of it would strand you |
| You are a superadmin | They need to see what an agent is stuck on, and may release it |

A locked row is muted grey all the way across, carries a padlock
(`components/LockIcon.tsx`) and *Locked* in place of a button, has a tooltip
naming the holder, and has no click handler at all - the lock has to be felt, not
only seen.

#### What the button offers

Not locked is not the same as claimable. `rowAction()` answers what this person
may actually do, and the queue mutes a row it answers `locked` for, naming the
holder from the row's tag - so the muting and the button are one rule and cannot
drift apart:

| `rowAction` | When | Button | What it does |
|---|---|---|---|
| `pick` | Nobody holds it | **Pick up** | Claims it, opens the workspace |
| `resume` | You hold it | **Resume** | Back into your own lead. Re-claiming it succeeds, but "Pick up" would imply taking something you already have. While it checks it reads *Opening...*, not *Picking up...* |
| `view` | Someone else holds it, you are a superadmin | **View** | Opens the workspace read-only; claims nothing, the holder keeps it |
| `locked` | Someone else holds it, you are an agent | *Locked* | Nothing |

- **Your own claim is checked before the superadmin rule**, so a superadmin
  working their own lead is offered Resume, not the read-only page.
- **The holder is matched by id** - `agentId` on the tag against the signed-in
  user's id - never by name, which two agents sharing a name would break
  (`lock.test.ts` has two called "Sam Okonjo").
- **A `working` tag with no holder id counts as unlocked.** The queue joins a
  claim through `users.is_active`, so a deactivated agent's claim returns no
  holder; muting it would strand a lead nobody could open.
- **Resume still asks the server.** It sends the same claim as Pick up; for a
  lead already yours `db/claims.ts` keeps `assigned_to` and the original
  `assigned_at`, and only `updated_at` moves. It asks because the queue on
  screen can be five seconds old: a superadmin may have released the lead and
  someone else picked it meanwhile. A 409 shows the holder's name and refreshes.

**Opening a lead never assigns it.** A row click, the lead's name as a link, and
View all open the same workspace, read-only - actions switched off, a strip
saying whose it is, and Pick up right there if nobody holds it. Only Pick up
claims. Looking also leaves an unread reply unread: the workspace marks it read
only for the holder (`AGENT-WORKSPACE.md`). The same three words are on every
screen that claims: My Callbacks' rows offer Pick up, Resume and View the same
way; the Lead Timeline header offers Pick up and Resume, and on a lead someone
else holds shows "Held by <name>" and no button, for a superadmin too.

Letting a lead go is the **Release** button on the lead's page, beside "Held by
you · since 3:04 PM": shown to the holder, and to a superadmin on anyone's lead
(`mayRelease`), and switched off during a call (`AGENT-WORKSPACE.md`, "Claim and
release").

### Types mirror the backend

`api/leads.ts`, `api/workspace.ts`, `api/admin.ts`, `api/calls.ts`,
`api/users.ts` and `api/types.ts` hold interfaces that mirror backend ones, each
naming the file it mirrors ("Mirrors LeadDetail in
backend/src/db/lead-detail.ts"). They are written by hand, so they can drift,
and a drifted one renders blanks rather than errors: **check a new type against
its backend counterpart by calling the endpoint**, not by reading the interface.

Internal values and screen words differ in a few places, on purpose:

| Stored or sent | Shown | Why it stays |
|---|---|---|
| conversation `status = 'completed'` | Ready - or Offers / Not interested, by `end_outcome` | A database value; renaming it is a migration for no change in behaviour. The API's lead status is already `ready` |
| queue tag kind `working` | Working – name | The same word |
| Overview `responded`, `completed` | Replied, Completed | Field names in one payload, read by one page |

Every date and time on screen is the viewer's own, from the browser's time zone;
where the server decides what "today" is - My Callbacks, Overview - the browser
sends its zone as `?tz=` (`viewerTimeZone`, `api/client.ts`). A request that gets
401 mid-use drops the app to `/login` with "Your session ended." (`AUTH.md`).

### Calling in the browser

`lib/calling.ts` is the only file that touches Twilio's Voice SDK. The SDK is its
own chunk, fetched once someone is signed in and calling is set up, because a
browser that can be rung has to hold a registered device. What a call looks like
on the lead's page is `TWILIO.md`, "The screen"; a lead calling in,
`INCOMING-CALLS.md`; telling the server whether this browser can take a call,
and the "Taking calls" switch, `AUTO-CALL-TRANSFER.md`, "Who is free".

### Building and serving

`npm run dev` in `frontend/` serves the app on :5173 and forwards `/api` to the
API on `127.0.0.1:3000` (`vite.config.ts`) - the same origin as far as the
browser is concerned, so the SameSite=Strict session cookie works as it does
behind Caddy. `npm run build` runs `tsc` then `vite build`, into `dist/`. In
production `frontend/Dockerfile` builds the app into the `caddy` service's
image, which serves `dist/` and forwards only `/api/*` to the API - which is why
every route lives under `/api`. Running everything locally is `RUNNING.md`.

## Rules

1. **Every live screen fetches through `usePolling`.** No screen has its own
   timer.
2. **The server decides; the screen only decides what to offer.** The lock, the
   admin guard, a disabled Wrap up - each saves a round trip or a confusing page,
   and the server refuses the same thing regardless.
3. **One action, one name.** Pick up, Resume and View mean the same on every
   screen, and a button says what the click does to the data, not where it goes.
4. **Only `lib/calling.ts` touches Twilio's SDK.**
5. **A type that mirrors the backend names the file it mirrors**, and a new one
   is checked by calling the endpoint.
6. **Style by role, through the tokens** - a size, weight or colour the tokens do
   not name fails the build (`FRONTEND-STYLE.md`).
7. **No dead controls.** A control that cannot work is not shown, and a gap with
   no data behind it is shown as a gap - the timeline's Consent ref reads "-" -
   so nobody wonders whether the page forgot it.
8. **Every row opens from the keyboard**: on the queue, Admin > Leads and the
   DNC list the lead's name is a link to the row's page (`a.cell-name`); the
   row's click stays for the mouse. Not on a locked row.

## Data

The frontend holds no data of its own: every read and write is a request to the
API, whose tables are in `SCHEMA.md`. In the browser it keeps only the session's
user (`auth/store.ts`), the incoming call's state (`lib/incoming-call.ts`), and
the view of Admin > Leads and the DNC list in the page's address, so Back
returns to the same tab, filters and page (`ADMIN-LEADS.md`, "The page";
`ADMIN.md`, "DNC list"); the queue and My Callbacks keep their view in memory and
start over.

## Code

| File | What it does |
|---|---|
| `frontend/src/App.tsx`, `main.tsx` | The routes; the entry point, which loads the styles and arms the ringtone |
| `frontend/src/auth/store.ts`, `auth/guards.tsx` | The session store; `RequireAuth` and `RequireRole` |
| `frontend/src/api/client.ts` | axios on `/api`, `toApiError`, the 401 that ends a session, `viewerTimeZone` |
| `frontend/src/api/usePolling.ts` | The polling hook |
| `frontend/src/api/leads.ts`, `workspace.ts`, `admin.ts`, `calls.ts`, `users.ts`, `auth.ts`, `types.ts` | One file per area: the requests and the mirrored types |
| `frontend/src/lib/lock.ts` | `rowAction`, `mayRelease` |
| `frontend/src/lib/format.ts` | Phone, dates, ages, names, and `dayLabel` - one rule for naming a day on every screen |
| `frontend/src/lib/useSecond.ts` | A clock that re-renders every second, for an age that ticks |
| `frontend/src/layout/AppShell.tsx`, `UserMenu.tsx` | The app bar and the page |
| `frontend/src/pages/LeadWorkspaceRoute.tsx` | The lead's page, made afresh for each lead |
| `frontend/src/pages/`, `pages/workspace/`, `pages/admin/` | One file per screen; the workspace's cards; the admin pages - each in its area's doc |
| `frontend/src/components/`, `styles/` | The shared kit and the stylesheets - `FRONTEND-STYLE.md` |
| `frontend/vite.config.ts` | The dev server's port and proxy, and the test setup |
| `frontend/Dockerfile` | The production Caddy image with the built app |

## Tests

`npm test` in `frontend/` - Vitest with jsdom and Testing Library - and
`npm run lint`, ESLint with the React hooks rules. Commands for every test in the
repo are in `TESTING.md`. Logic first: a screen is easy to judge by eye, a
dropped response or an off-by-one is not. Each area's own frontend tests are in
its doc's Tests table; these are the shared parts':

| What | Where |
|---|---|
| The polling hook: data kept through a tick and an error, loading only with nothing to show, one request at a time, a stale answer dropped, the timer stopped on unmount, `refresh`, `keepPreviousData`, `enabled` | `frontend/src/api/usePolling.test.ts` |
| Which row action and lock a lead gets, matched by id; who may release a held lead | `frontend/src/lib/lock.test.ts` |
| Formatting - phone, dates, ages, the day label | `frontend/src/lib/format.test.ts` |
| The lead's page made afresh for each lead | `frontend/src/pages/LeadWorkspaceRoute.test.tsx` |
| A dialog's focus: taken on opening, kept inside on Tab, given back on closing | `frontend/src/components/Modal.test.tsx` |
| The sliding switcher | `frontend/src/components/Segmented.test.tsx` |
| The date and time picker: the month grid, quarter hours, past days off, Clear, Escape | `frontend/src/components/DateTimeField.test.tsx` |
| The type scale, one import per stylesheet, duplicate selectors and properties, undefined tokens | `frontend/src/styles/type-system.test.ts` - `FRONTEND-STYLE.md` |

## Not done

- **Live push.** Polling stands in for it, deliberately: at 50-100 leads a day
  nobody can tell it from a push, and replacing it means rewriting
  `usePolling.ts` alone.
- **A list of every held lead and how long it has been held.** A superadmin finds
  them in the queue, as "Working – name", and releases one from its page.
- **No data for State or Consent ref.** EZ Texting sends neither: State is not
  shown anywhere, and Consent ref reads "-" on the timeline page
  (`EZTEXTING-API.md`, `TIMELINE.md`).

### Differences from the brief

`DESIGN-PROMPT.md` is kept as it was written. Where the app went another way:

| The brief | Built | Where |
|---|---|---|
| Superadmin edits scoring, tiers, copy, settings and the DNC list | Sees them, read-only; Agents and Seri's switch are the only controls | `ADMIN.md` |
| Type at 13-14px in tables, 16px in forms | Five sizes by role; 14px body everywhere, forms included | `FRONTEND-STYLE.md` |
| App bar: EZ Texting and Twilio connection dots, avatar initial, role badge | The user menu with name and role in plain text, and the "Taking calls" switch with automated calls on. System status is on Admin > Overview | `ADMIN.md`, `AUTO-CALL-TRANSFER.md` |
| Toasts, bottom right: new HOT lead, SMS sent, call ended, saved, errors; never over the Call button | None. A save is confirmed in place; the one corner notice is the incoming-call card, top right | `INCOMING-CALLS.md` |
| A keyboard shortcut overlay (`?`); in the workspace `C`, `S`, `N`, `1-7`, Cmd/Ctrl+Enter; rows moved through with ↑ ↓ Enter | None. Enter sends in the message box and saves the after-call note; Escape closes a menu or dialog; rows are reached with Tab, the lead's name a link (rule 8) | this doc |
| Skeleton loaders for tables | A spinner, except Admin > Agents' skeleton rows | this doc |
| Queue: tier counters as pills, several at once; filters and table apart | One segmented switcher - All, Hot, Warm, Low with counts - one at a time; filters and table in one card | `QUEUE.md` |
| Source as a multi-select | A single choice, on the queue and Admin > Leads; the APIs take several | `QUEUE.md`, `ADMIN-LEADS.md` |
| Queue sorted by score, then freshness | The promised calls first, then by tier - Hot, Warm, Low - newest first in each | `QUEUE.md` |
| Queue columns STATE, INTEREST, TIMING, PREFERENCE, AGE | No STATE; one Answers column; WAITING, with no amber or red | `QUEUE.md` |
| Queue statuses New, Attempted, In progress, Callback, Needs review, Stalled, Inbound reply, Seen before | The tags of `QUEUE.md`, "The tag" | `QUEUE.md` |
| Coloured tier badges | Signal bars and the word | `FRONTEND-STYLE.md` |
| An "Open" button, with quick Call and SMS icons on hover | Pick up, Resume, View or Locked; no hover icons - calling and texting are done from the workspace | this doc |
| A row click opens the workspace | It opens it read-only and claims nothing | this doc |
| New rows animate in at their sorted place | Only Admin > Leads highlights a new row; the queue does not animate | `ADMIN-LEADS.md` |
| A small unread dot on an Inbound reply row | An icon and the words in bold; Missed call is bold the same way | `FRONTEND-STYLE.md` |
| Workspace in three columns, 30/40/30: lead card and actions, timeline, right column | A header card over three cards: what the lead told us and the score breakdown, the conversation, Wrap up | `AGENT-WORKSPACE.md` |
| Lead card: tier badge, State, a copy button on the phone; flags Seen before and Inbound reply; a Next lead link | None of those; the flags the page shows are in `AGENT-WORKSPACE.md`; "Lead 3 of 12" beside Back to queue | `AGENT-WORKSPACE.md` |
| Call control states, including "Twilio disconnected", and an outcome filled in after the call | A Call button and a call bar; neither that state nor an outcome filled in | `TWILIO.md` |
| An SMS button opening a compose box | The message box always at the foot of the conversation | `AGENT-WORKSPACE.md` |
| Note: auto-saves a draft, "Add note" | No draft. The note is saved with Save, or from the call bar after a call | `AGENT-WORKSPACE.md` |
| Callback: "Assign to", a superadmin picking any agent | Not on the screen: Wrap up books it for whoever saves; the API takes `agentId` | `CALLBACKS.md` |
| Seven dispositions | Closed - asked why in a popup: Sold, Not interested or Wrong number - and DNC | `AGENT-WORKSPACE.md` |
| Save, and Save & next lead | Save only | `AGENT-WORKSPACE.md` |
| An unsaved-changes guard on leaving | Only on closing or reloading the tab; a move inside the app is not stopped | `AGENT-WORKSPACE.md` |
| Lead Timeline header: name, tier and score, state, phone, source, Call and SMS buttons | No state, and no Call or SMS buttons - Pick up or Resume, or "Held by <name>" | this doc |
| Timeline: earlier leads for the same phone in a "Previous lead" section; a duplicate check with a link | Not built - repeat leads are a future item; the check always reads "not seen before" | `TIMELINE.md` |
| My Callbacks: three tabs, overdue rows tinted, Open / Call / Reschedule / Mark done | A card with four tabs; overdue in amber; Pick up / Resume / View beside a "⋯" | `CALLBACKS.md` |
| An "Agent" filter for a superadmin's callbacks | Built, as a labelled Agent picker | `CALLBACKS.md` |
| Admin sub-menu: Overview, Leads, Scoring, Messages, Agents, DNC list, Settings | Overview, Leads, Agents, Configuration, DNC list | `ADMIN.md` |
| Overview: eight KPI cards, a funnel, call figures per agent | Five totals - Sold among them - an agents table, system checks, recent activity | `ADMIN.md` |
| Scoring editable inline, tier ranges, a preview panel, Save rules, Recalculate existing | Read-only cards; no preview panel; Recalculate dropped | `ADMIN.md` |
| Message copy editable, placeholder chips, a phone-frame preview | Read-only, with character and segment counts; `{first_name}` as a chip; no phone-frame preview | `ADMIN.md` |
| Agents: row actions as buttons | Behind one "⋯" menu | `AUTH.md` |
| DNC list: Added by, Add manually, Export CSV | No Added by (the agent behind it is in the activity log); no manual add; no export | `ADMIN.md` |
| A Settings page: expiry, delivery type, lead group, poll interval, caller ID, SMS templates | Not built. Expiry is shown on Configuration; the lead group and the caller ID are environment variables; the poll interval is a `settings` row; the segment limit is a constant, 160; the agents' SMS templates are in the code | `ADMIN.md`, `ENVIRONMENT.md`, `AGENT-WORKSPACE.md` |
| Admin > Leads: its tabs, Step reached Q1-Q3, a warning banner when the poll is stale | Its own statuses, the question the lead is on, a quiet sync line | `ADMIN-LEADS.md` |
| Not in the brief: a lead calling in | A card in the top right corner on every screen | `INCOMING-CALLS.md` |

## Decisions

| Decision | By | Date |
|---|---|---|
| Every live screen updates by polling every 5 seconds, from one hook, not a push | Jeel | 2026-09-23 |
| Tests cover logic first; screens are judged by eye | Jeel | 2026-09-26 |
| Opening a lead never assigns it: a row click and View only look, read-only, on the same workspace; only Pick up claims | Jeel | 2026-09-28 |
| The button says what the click does: Pick up, Resume, View, on every screen that claims | Jeel | 2026-09-28 |
| A switch keeps the old rows on screen, faded and unclickable, instead of a spinner | Jeel | 2026-09-28 |
| "Blue" means the brand navy; no selected tab uses the link blue | Jeel | 2026-09-28 |
| Each viewer's day is their own: "today" in the browser's time zone | Jeel | 2026-09-28 |

## History

- 2026-11-28 · Overview's five totals, Sold the fifth; `.stats` takes as many columns as it has totals · Admin counts sales · B05
- 2026-11-28 · Closed asks why, in a popup, the reason shown as "Closed · Sold" (`outcomeLabel`) · Jeel: one Closed stood for sold, not interested and wrong number alike · B04
- 2026-11-28 · The queue's order - by tier, newest first, not by score - added to "Differences from the brief" · B01
- 2026-11-27 · Rewritten to the Area template, 937 lines to this: the queue, admin,
  workspace, callbacks, timeline and calling sections handed to their docs
  (`QUEUE.md`, `ADMIN.md`, `ADMIN-LEADS.md`, `AUTH.md`, `AGENT-WORKSPACE.md`,
  `CALLBACKS.md`, `TIMELINE.md`, `TWILIO.md`, `INCOMING-CALLS.md`,
  `AUTO-CALL-TRANSFER.md`, `RUNNING.md`); the type system, class names, date picker and icons
  to `FRONTEND-STYLE.md`; the polling hook and the on-screen lock taken back from
  `QUEUE.md`; the stack given `@twilio/voice-sdk`; test counts dropped; the
  "Differences from the brief" table from `DESIGN-PROMPT.md`'s notes · one fact,
  one place · D26-D30
- 2026-11-24 · Seri's switch on Configuration's Calls tab, the one control there;
  `ConfirmDialog` moved to `components/` for it · Jeel: stop her from a browser ·
  `ADMIN.md`
- 2026-11-23 · Code-quality review on `fix/review-quality-frontend`: the lead's
  call refreshes once, and `useLeadCall` got its tests (Q7); `Timeline`'s
  `autoScroll` with its ref (a `<div>` inside an `<ol>`), `lockHolder` and
  `answersText` removed as called only by their tests - the lock's tests kept as
  tests of `rowAction` (Q7); one `dayOrDate` behind `formatReceived` and
  `formatLastLogin` (Q7); every row opens from the keyboard, dialogs take focus
  and give it back, the Wrap up note named by its heading, the DNC list's view in
  the address (Q8). Proved by the tests and the build; the name links and the
  dialog focus were not looked at on screen. The Lead Timeline header's states
  written down (R15) · `REVIEW-2026-11-22.md`
- 2026-11-22 · The website's medium review findings: two call bars stack (M26);
  Release waits for a call taken on the page (M27); calling's settings asked
  again every 15 seconds until they answer (M28); a ring ends however it ends
  (M29); Admin > Leads flashes only new rows (M30); a failed load says so (M31);
  "you tried" by id (M32); a failed Reactivate says so (M33). The lead's page made
  afresh for each lead: going from one lead to another kept the first's
  after-call note box and saved its note to the second (H6) ·
  `REVIEW-2026-11-22.md`
- 2026-10-11 · The dev proxy names `127.0.0.1`, not `localhost` · another
  project's server on `[::1]:3000` took every `/api` call (`RUNNING.md`)
- 2026-10-08 · Back to queue only goes back; letting a lead go is the Release
  button, for the holder and a superadmin. Until then Back to queue released the
  holder's own claim on the way out · Jeel · `AGENT-WORKSPACE.md`
- 2026-10-06 · A screen asks again five seconds after the last answer, not on a
  fixed timer · requests piled up on a slow server
- 2026-10-05 · The queue's three fixed answer columns became one Answers column,
  and the list of answer names in `lib/format.ts` went: every word comes from the
  server · flows differ in length · `QUEUE.md`, `FLOWS.md`
- 2026-10-01 · Calling built (Phase 4): the Call button and the call bar, the
  incoming-call card, Missed call. The brief's "Browser calling is off · Enable"
  link had been left out of the workspace - a link that went nowhere - with a
  note that calling was off until Phase 4; both went · `TWILIO.md`
- 2026-09-28 · Opening a lead stopped assigning it: the button read "Open", then
  **Pick**, then **Pick up** the same day, and gained Resume and View - Pick on a
  lead someone held always returned 409 for a superadmin. For an hour that day a
  row click opened the Lead Timeline instead; two pages for one lead read as two
  different things, so both land on the workspace. Resume's re-claim checked
  against the database: `assigned_at` does not move. The lock matched the holder
  by name until the same day, when the tag gained `agentId` - two agents with the
  same name each saw the other's lead as their own Resume row and got a 409;
  found in review · Jeel
- 2026-09-28 · Every page with the navy switcher keeps its table through a switch
  (`keepPreviousData`), checked with every API answer slowed by 400ms: the table
  never blanked, stayed faded for the wait and was never clickable while faded;
  My Callbacks joined the same day · Jeel: "really smooth, can we add same on
  other tab"
- 2026-09-28 · The queue, Admin > Leads, My Callbacks, Overview, Agents and the
  workspace rebuilt to Jeel's mockups, each in its area's doc; ESLint added; the
  admin side menu's greyed "Soon" links - Overview, Scoring, Messages, DNC list,
  Settings - removed: two duplicated live links, the rest had been folded into
  Configuration on 2026-09-23 · `FRONTEND-STYLE.md`
- 2026-09-26 · Built: Phase 3 tasks 14-25, every screen in the brief except
  calling - `usePolling.ts` (task 14), onto which `admin/LeadsPage.tsx` moved from
  its own copy of the interval, and the lock on screen (task 16). Run against the real endpoints, two mirrored types were wrong and
  would have rendered blanks: `Note` carries `author`, not
  `agentId`/`agentName`; the callback list row's lead has no `id` and no
  `score`, and does have `source` · Phase 3
