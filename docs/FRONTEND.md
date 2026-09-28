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

## Type system - 2026-09-28

Measured before this change: **ten font sizes across nine screens**, where five
would do. Three were fractions - 11.9, 12.48 and 13.6px - from `0.85em` and
`0.85rem` resolving against whatever they sat inside. And 12, 13 and 14px were
all in heavy use, one pixel apart: too close to read as deliberate levels, too
far to look the same, so text meant to match looked slightly off. Card titles
came in two styles - 14px on the workspace, a 12px uppercase caption on
Overview, Config and the timeline sidebar - because those pages borrowed a class
designed as a label.

Now there are five sizes and three weights, named by role in `tokens.css`:

| Role | Size | Weight | For |
|---|---|---|---|
| heading | 20 | semibold | page titles, the lead's name |
| title | 16 | semibold | card titles |
| section | 14 | semibold | a heading inside a card |
| body | 14 | regular | cells, buttons, forms, messages |
| label | 12 | semibold, uppercase, tracked | column heads, captions, badges |
| meta | 12 | regular | timestamps, hints, counts |
| display | 24 | bold | scores and KPI figures |

**Pick the role, not the size.** The tokens are `--text-small`, `--text-body`,
`--text-title`, `--text-heading` and `--text-display`, plus `--weight-regular`,
`--weight-semibold`, `--weight-bold` and `--tracking-label`. There is no token
for 13px, deliberately.

**Badges are labels.** HOT / WARM / LOW were 12px bold (700) directly under a
TIER heading at 12px semibold (600) - same size, same capitals, different
weight, which is the almost-match this change exists to remove.

**Headings default to semibold,** in a base rule, so a rule that forgets its
weight gets the heading weight rather than the browser's bold.

**Enforced, not hoped for.** `src/styles/type-system.test.ts` reads both
stylesheets and fails on a size, weight or caption style the tokens do not
name, on sizes closer than 2px apart, on a property declared twice in one rule,
and on the same selector defined twice at the top level - a second `.avatar`,
added for the workspace, had silently restyled the app bar on every page. Each
check was proven by breaking the stylesheet on purpose and watching it fail.

Two things worth knowing about that test. It imports the stylesheets with
`?raw`, not `node:fs` - this is a browser app with no Node types, so `node:fs`
fails `tsc` and with it `npm run build` - and Vitest replaces CSS with an empty
string unless told otherwise, `?raw` included, so `vite.config.ts` opts these
two files in. An earlier version read an empty string and passed four checks
over nothing; the "really loaded" check now fails if that ever happens again.

**Layout fixes found while measuring.** Checked for horizontal overflow on all
nine screens at 1280, 1366, 1440 and 1920px. Two screens already overflowed on
`dev`, before this change: Config (the scoring options sat side by side in a
nowrap cell, 240px past the window) and Agents (three row actions side by side,
past a 1366px laptop). Scoring options now stack; row actions and Config's row
labels wrap. None overflow now. The shared table rules also lost two bugs: the
last row's divider and the hover highlight applied to data cells but not row
labels, leaving half a line under "Maximum possible".

**Admin > Leads tabs are tighter - 2026-09-28.** Working and Closed made nine
tabs, and the ninth wrapped onto a second line below 1366px. Narrower tab sides
keep all nine on one line down to 1280px, measured.

**Removed:** the admin sidebar's greyed "Soon" links - Overview, Scoring,
Messages, DNC list, Settings. Two duplicated live links; the rest were folded
into Configuration on 2026-09-23.

## The queue - redesigned 2026-09-28

Rebuilt to a mockup Jeel supplied. What changed and why:

| Part | Was | Is |
|---|---|---|
| Layout | Filters and table loose on the page | One card holding both, the table head a light grey band |
| Tier filter | Three pills, several at once | One segmented switcher - All, Hot, Warm, Low with counts - one at a time |
| Tier column | Coloured badge | Signal bars and the word, `components/TierSignal.tsx` |
| Age column | "AGE", amber and red | "WAITING", monospace, one weight and colour for every lead |
| Status column | Coloured pills, six statuses | A dot and the words, three statuses, a hyphen otherwise - `components/QueueStatus.tsx` |
| Button | Pick | **Pick up** - on every screen that picks, so the action has one name |
| Someone else's lead | "Locked" | A padlock and "Locked", `components/LockIcon.tsx` |
| Action column | Right-aligned | Centred - buttons and Locked on one axis |
| Button hover | Light grey | Fills with the header's navy, white text - Pick up, Resume and View alike |
| Chosen tier | White on grey | The header's navy, white text - the same look as a hovered action - on a thumb that slides to the chosen option. `components/Segmented.tsx`, shared with the Add agent drawer's role choice |
| Empty cells | `-` | `-` - an em dash was tried and reverted |
| Live label | Live | Live · updated just now |

**Only three statuses, and most rows have none - Jeel, 2026-09-28.**
Working – name (was In progress – name), Inbound reply and Needs review, each a dot and the words; any
other row shows a hyphen, like any other empty cell. New, Attempted 2x and
Callback 3:00 PM are gone: that history belongs to the agent working the lead
(My Callbacks, the timeline), and on the home page it gave every row something
to say. Which status wins, and why New went too, is in `QUEUE.md`, "The tag".
Two raise their voice: Inbound reply in bold, Needs review with a warm dot - the
two a person must get to first. `QueueStatus.test.tsx` pins each one.

*(Earlier the same day the mark's shape carried meaning - a ring for waiting, a
square for a past attempt. With only three statuses, all of them live, the
shapes had nothing left to tell apart.)*

**Every waiting time looks the same - Jeel, 2026-09-28.** The column first kept
the brief's thresholds as weight - bold past 15 minutes for HOT - but that left
it half dark and half light, and the bold even showed on a greyed-out locked
row. Now every value has the same weight and colour, and a locked row is grey
all the way across. `ageTone` in `lib/format.ts`, which held the thresholds, had
no other caller and is gone with its tests. The age still ticks every second.

**The segmented control is one component, and its navy slides** - Jeel,
2026-09-28, "not smooth". `components/Segmented.tsx` replaces the markup the
queue and the Add agent drawer each wrote by hand. The navy is a thumb behind
the options that glides to the chosen one in 220ms, fast in the middle and
easing to a stop. Its position is measured, because options differ in width
and the queue's counts change them. It is placed before the first paint and
only animates after, so a page never opens with it sweeping in; until it is
placed the chosen option carries the navy itself, so white text never sits on
the grey track; and `prefers-reduced-motion` switches instantly. Measured: the
thumb passed 20, 159, 204 and 219px on its way from 2px to 228px.

**The tier switcher is one choice at a time.** The old pills allowed Hot and
Warm together; the segmented control, as drawn, does not. The API still accepts
several tiers if a screen ever wants them again.

**Fixed while building it:** `--color-surface-alt` was used in seven places and
defined nowhere, so the browser dropped every one - queue row hover, the grey
of a locked row, the quick-callback chips' hover, Config's message boxes and
the Overview funnel track had never rendered. They use `--color-surface-hover`
now, and `type-system.test.ts` fails on any `var()` that is not defined.

**Checked** on a separate dev server at 1280, 1366, 1440 and 1920px: the table
fits its card at every width, and the switcher shows the right rows with its
counts unchanged.

## The workspace - redesigned 2026-09-28

Rebuilt to a mockup Jeel supplied. Every action behaves as before - checked by
driving each one through the browser, listed at the end of this section.

**One page for every lead, picked or not.** On a lead you hold, everything
works. On any other, the page is identical, but the wrap-up and the message box
are each a disabled `<fieldset>` - one attribute switches off every control
inside, so none can be missed - and a strip above the header says why. The
server refuses the write regardless (`AGENT-WORKSPACE.md`, "Rules"), so the
disabled controls save a round trip rather than enforce anything.

**Layout.** A full-width header card - avatar, name and tier, score out of 100,
ticking lead age, source, SMS flow state, and the Send SMS and Call buttons -
over three cards: what the lead told us and the score breakdown; the
conversation; and the wrap-up.

**The centre column is a conversation, not a log.** `workspace/Conversation.tsx`
shows the SMS thread and the system markers only - inbound on the left, ours on
the right, automated sends marked `Auto` and an agent's own send carrying their
name, so the rule 2b handoff is visible in the thread itself.

That is a real change and worth knowing: **notes, callbacks, dispositions and
calls are no longer in the workspace centre.** They are on the Lead Timeline,
which the conversation header links to, and which still uses `Timeline.tsx`
unchanged. An agent on a call wants what the lead said; the full audit trail is
one click away.

**An inbound digit is labelled only when it provably matches.** `3` becomes
"3 | Both" when the conversation's recorded answer to that question is 3. The
matching walks the stored choices in order and advances only on a match, so an
unclear reply cannot shift every later label by one, and a worded answer like
"today please" stays plain text. `labelReplies()` has tests for each of those.
This needed the raw `choice` on each answer chip - `AGENT-WORKSPACE.md`.

**The composer is a message box.** Always present at the foot of the thread,
Enter to send and Shift+Enter for a new line, templates behind a button. The
header's Send SMS puts the cursor in it. The takeover warning appears once there
is text and before the first send, as before; the 160-character limit and the
blocked-number notice are unchanged.

**The wrap-up is the old actions panel regrouped.** Outcomes are grouped
Positive / No contact / Negative. *(2026-09-28: Sold added, first under
Positive. Sold, Not interested and Wrong number close the lead -
`AGENT-WORKSPACE.md`.)* DNC is a separate red link, not one of the
buttons - it still opens the same confirm dialog. The quick callback chips gained
"Pick time...", which reveals the date field. "Step N of 3" shows which section
still wants something: outcome, then callback or note - the callback is optional,
so it never holds the step back on its own. Save, Save & next and the unsaved
changes guard are untouched.

**"Lead N of M"** is fetched once when the workspace opens, not polled. It is
orientation, and a number shuffling under the reader would be worse than a stale
one. It is absent when the lead is not in the queue, which is normal - opening
a lead can be what takes it out.

**`.card` has no global style.** It is used on the admin and timeline pages too,
which render flat. The workspace scopes its card rule to `.workspace .card`, so
this redesign changes no other screen. A global rule would give those pages
cards too - a separate decision.

**Not in the mockup, deliberately:** its "Browser calling is off · Enable" link.
Calling is Phase 4; a link that goes nowhere is the kind of dead control this
phase already removed once. The note says calling is off until Phase 4.

**Checked in the browser, 2026-09-28** - Send SMS focuses the composer;
templates fill it and the takeover warning shows; Send enables and disables with
the text; Pick time reveals the picker; a quick chip sets the callback; choosing
an outcome advances the step; DNC opens the confirm and Cancel leaves the
outcome alone; Save posts note, callback and disposition and clears the form;
Save & next releases and opens the next lead; the timeline page still shows all
three; unclear replies stay unlabelled; a blocked number hides the composer and
Send SMS; Back to queue releases the claim. No console errors.

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

**Opening a lead never assigns it - Jeel, 2026-09-28.** A queue row click, a
superadmin's View and the Pick button all open the same workspace. Only Pick
assigns the lead; opened any other way, the workspace shows the lead read-only -
actions switched off, a strip saying whose it is, and Pick right there if nobody
holds it. Looking also leaves an unread reply unread: the workspace marks it
read only for the holder, so a glance no longer lets a lead who texted back drop
out of the queue. A 409 on Pick still shows the holder's name and refreshes.
*Back to queue* and *Save & next* release the claim - and only a claim that is
yours, so a superadmin leaving someone else's lead no longer takes it off them.

(For an hour earlier the same day, a row click opened the Lead Timeline instead.
Two different pages for the same lead read as two different things, so both now
land on the workspace.)

**The button says what the click does to the database - Jeel, 2026-09-28.** It
read "Open", which described where the click went rather than what it did: it
writes `leads.assigned_to` and locks every colleague out. An agent could take a
lead believing they had only looked at it. It is now **Pick up**, and two further
states follow from the same rule - **Resume** on your own lead, **View** on
someone else's when you are a superadmin. `QUEUE.md`, "What the button offers",
is the table. The same wording is on the My Callbacks row and the Lead Timeline
header, which claim the same way.

**The lock is decided in `lib/lock.ts`.** The server enforces it; the screen has
to decide which rows to mute before anyone clicks. `lockHolder()` answers
"is this row muted", `rowAction()` answers "what may this person do" - and the
first is derived from the second so they cannot disagree. `QUEUE.md`, "The
one-agent lock on screen", has both tables and the known weakness: the holder is
matched by name because the queue endpoint returns no id.

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
- **Force-release.** `POST /api/leads/:id/release` already lets a superadmin
  release anyone's claim, and `AGENT-WORKSPACE.md` promises it, but no screen
  offers it. Today a claim clears only when the agent leaves the workspace.
