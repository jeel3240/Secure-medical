# Frontend

The React app: what exists, how the screens fetch, and the decisions that are
not obvious from the code. `DESIGN-PROMPT.md` is the brief - what the screens
should be. This is what they are.

React 18, Vite 4, React Router 6, zustand, plain CSS with design tokens. No UI
framework: the components in `src/components` are the whole kit.

**Built 2026-09-26** - Phase 3 tasks 14-25, the frontend half. Every screen in
the brief now exists except calling, which is Phase 4. *(Calling was built on
2026-10-01 - `TWILIO.md`.)*

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
| Status column | Coloured pills, six statuses | An icon and the words, four statuses (Callback came back 2026-09-29), a hyphen otherwise - `components/QueueStatus.tsx` |
| Button | Pick | **Pick up** - on every screen that picks, so the action has one name |
| Someone else's lead | "Locked" | A padlock and "Locked", `components/LockIcon.tsx` |
| Action column | Right-aligned | Centred - buttons and Locked on one axis |
| Button hover | Light grey | Fills with the header's navy, white text - Pick up, Resume and View alike |
| Chosen tier | White on grey | The header's navy, white text - the same look as a hovered action - on a thumb that slides to the chosen option. `components/Segmented.tsx`, shared with the Add agent drawer's role choice |
| Empty cells | `-` | `-` - an em dash was tried and reverted |
| Live label | Live | Live · updated just now |

*(2026-09-29: a fourth, **Callback – Maya Chen · 8:13 PM** with a clock icon,
came back - see below and `QUEUE.md`, "The tag".)*

**Only three statuses, and most rows have none - Jeel, 2026-09-28.**
Working – name (was In progress – name), Inbound reply and Needs review, each an icon and the words; any
other row shows a hyphen, like any other empty cell. New, Attempted 2x and
Callback 3:00 PM are gone: that history belongs to the agent working the lead
(My Callbacks, the timeline), and on the home page it gave every row something
to say. Which status wins, and why New went too, is in `QUEUE.md`, "The tag".
**Each status has its own icon - Jeel's mockup, 2026-09-28:**

| Status | Icon | Why |
|---|---|---|
| Working – name | Half-filled circle | Started, not finished |
| Inbound reply | Message box with an arrow pointing in | A text has come to us. The words are bold too: nobody has read it |
| Needs review | Warning triangle | A person has to look at the replies |

The icons are inline SVG outlines on a 24-unit grid, drawn in the text colour
like the padlock, so a locked row greys its icon with its words.
`QueueStatus.test.tsx` checks that each status has its own icon and that no dot
is drawn.

*(Earlier the same day each status had a dot - first a filled dot, a ring or a
square, then a plain dot, with Needs review's in a warm colour. Jeel: a dot
said only "something"; an icon says which.)*

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

## Admin > Leads - redesigned 2026-09-28

Rebuilt in the queue's style, from the queue's own parts, so the two screens
cannot drift apart. `ADMIN-LEADS.md`, "The page", has the before-and-after.

**Shared, not copied.** Three pieces moved out of the queue so both pages use
them:

| Component | Does |
|---|---|
| `components/StatusIcon.tsx` | Every status icon, one set. Working is the half-filled circle and Needs review the triangle on both pages |
| `components/LiveStatus.tsx` | "Live · updated just now", with its own one-second clock |
| `components/LeadStatus.tsx` | An Admin > Leads status as an icon and words |

`QueueStatus.tsx` now draws its icons from `StatusIcon`; the queue looks the
same.

**Fixed while building it:** a right-aligned column's heading stayed on the
left - `.table th` outranked `.right` - so SCORE and WAITING on the queue sat
away from their numbers. `.table th.right` fixes both pages.

**The status tabs are the queue's switcher - Jeel, 2026-09-28.** They were
underline tabs in the link blue (`--color-accent`). Jeel: blue means the brand
navy, the header's colour. They are now `Segmented`, like the queue's tier
switcher: the chosen status in navy, sliding between options. The underline
tabs left on My Callbacks moved to navy as well, so no selected tab anywhere
uses the link blue. *(Later the same day the DNC list was rebuilt the same way
as Admin > Leads, switcher included - `ADMIN.md`, "DNC list".)*

**Checked** at 1280, 1366, 1440 and 1920px: all nine statuses stay on one line,
and nothing overflows the card. A row click opens the timeline; no console errors.

## My Callbacks - rebuilt 2026-09-28

In the other pages' style: one card with the navy Today · Upcoming · Overdue ·
All switcher and its counts, the smooth switch, the phone under the lead's name
and the tier as bars. **Pick up** sits beside a "⋯" holding Reschedule and Mark
done. An overdue callback says so in amber under its time rather than turning
the row red; a done one (on All) says Done.

**A superadmin's picker is labelled and complete** - Jeel: "what is this
dropdown?". It was an unlabelled select reading "My callbacks" that listed
other agents but had no way to see everyone's, and the title stayed "My
callbacks" whatever it showed. Now it reads **Agent: Me · All agents · karm…**,
the title follows it ("All callbacks", "karm's callbacks"), and All agents adds
an Agent column. The API took `agentId=all` for it (`AGENT-WORKSPACE.md`).
Agents see no picker.

The underline tabs were the last of their kind; their styles are gone.

**The row's button follows who holds the lead - 2026-09-29.** It said Pick up
on every row, even to the agent already holding that lead. Now the list carries
the lead's holder (`holder` on each row, `db/callbacks.ts`): **Pick up** when
nobody holds it, **Resume** to its holder, and **View** to anyone else - which
only opens the lead, read-only, since a claim would be refused.

## Switching is smooth everywhere - 2026-09-28

Jeel, after the Overview's period switch: "really smooth, can we add same on
other tab". Every page with the navy switcher now keeps its table on screen
through a switch - the queue (tier, and the search), Admin > Leads (status),
the DNC list (state) and Overview (period). The old rows fade and cannot be
clicked until the new ones land; only the table fades, so the switcher itself
stays sharp. `usePolling`'s `keepPreviousData` - QUEUE.md, "The polling hook".

Checked with every API answer slowed by 400ms: on all three table pages the
table never blanked, stayed faded for the wait, and was never clickable while
faded. My Callbacks joined them the same day.

## Admin > Overview - rebuilt 2026-09-28

Now in the same card style as every other admin page: the navy period switcher
and "Live · updated" at the top right; four totals in one card split by thin
rules (`.stats`); the Agents table and the System checks side by side; Recent
activity across the page, the lead names in the brand navy. What each part
shows, and what was removed and why, is in `ADMIN.md`, "Overview". The old
`.kpi`, `.funnel`, `.overview__*` rules, and `.config__title` and
`.config__choice` which only it still used, are gone.

## Admin > Agents - redesigned 2026-09-28

Laid out like the other admin pages: one card, the grey header band, the
email under the name, role and status as an icon and words - Superadmin a
shield, Agent a person; Active a tick, Pending first sign-in a clock in amber,
Inactive a barred circle, muted.

**Row actions behind one "⋯" menu** - `components/RowMenu.tsx`. Three text
buttons on every row were most of what made the table busy. The button goes
navy on hover like every other action; Deactivate is red in the menu. Your own
row has no menu: you cannot change your own role or deactivate yourself, and
your password is changed from the user menu.

The menu's panel is `position: fixed`, placed from the button when it opens,
because `.table-wrap` scrolls sideways and clips anything positioned inside it -
the last row's menu would be cut off. It closes on Escape, an outside click, a
scroll or a resize. Checked in the browser, with Reset password opening its
dialog from the menu. `.table__actions` and `.table__name`, used only here, are
gone.

## The workspace - redesigned 2026-09-28

Rebuilt to a mockup Jeel supplied. Every action behaves as before - checked by
driving each one through the browser, listed at the end of this section.

**One page for every lead, picked or not.** On a lead you hold, everything
works. On any other, the page is identical, but the wrap-up and the message box
are each a disabled `<fieldset>` - one attribute switches off every control
inside, so none can be missed - and a strip above the header says why. The
server refuses the write regardless (`AGENT-WORKSPACE.md`, "Rules"), so the
disabled controls save a round trip rather than enforce anything.

**Layout.** A full-width header card over three cards. The header was made
plainer on 2026-09-29 - Jeel: the first one read as generated (initials circle,
tiny letter-spaced uppercase labels, monospace phone and source, a big red
score, a dashed Call button, a "Phase 4" note). It is now the full name; one
quiet line of phone, source in words ("Web interface") and age; Score "90 /
100" and Questions in the Step column's words ("On Q2", "Stopped at Q2",
"Completed"); and a plain disabled Call whose reason is a tooltip. The tier
and a Send SMS button went the same day - Jeel: the score already says how
strong the lead is, and Send SMS only moved the cursor to the message box just
below. On a phone the phone, source and age stack. Also that day: the three answers under "What
Priya told us" became plain text, not three coloured pills, and "Full timeline
→" became a quiet grey link that turns navy on hover, not link blue. The score breakdown's bar and swatches
run from light blue to the brand navy, and its total is navy - they were the
Hot red at rising opacity, an alarm colour on every lead (same day). The three
cards below are: what the lead told us and the score breakdown; the
conversation; and the wrap-up.

**Files.** `WorkspacePage.tsx` holds the data, picking and releasing, and the
layout. Each card is its own component in `pages/workspace/`: `LeadHeader`,
`LeadAnswers` and `LeadNotes` (the left column), `Conversation` with `SmsCompose` under it, and
`ActionsPanel` (Wrap up). The first two were split out of the page on
2026-09-28, when it had reached 420 lines; the rendered page was checked
identical before and after, HTML and every computed style, on six leads.

**Notes are on the workspace - Jeel, 2026-09-29.** A Notes card under the
score breakdown lists the lead's notes newest first, each with who wrote it and
when; the three newest show and "Show all N" opens the rest in place. Until
then notes were only on the Lead Timeline page, so the agent about to call - who
most needed "wants a call after 5 PM" - never saw them, and a note saved in
Wrap up vanished from the screen. The card reads the timeline the page already
polls, and the page now refreshes that timeline after every save, so a new note
(or a sent text) shows at once. `LeadNotes.test.tsx`.

**The conversation keeps its newest message in view.** On opening and on every
new message the scrolling box goes to its very end. Until 2026-09-29 it
scrolled a marker after the last message into view, which stopped short by the
box's padding, so the newest message's name and time sat below the edge and a
sent text looked as if it had not arrived - Jeel. Measured after the fix: 0px
left below, on open and after each of three new messages.

**A call lives in a bar at the foot of the screen - Jeel's design,
2026-10-01.** The header has a Call button; the call itself - who, the clock,
Mute, Keypad, End - is `CallBar.tsx`, which slides up and stays in view, and
becomes a note box when the call ends. A lead calling in uses the same bar,
from `layout/IncomingCallBar.tsx` in the app shell, so it appears on any
screen: Answer and Decline while it rings, "Missed call" if nobody picks up
(`TWILIO.md`, "Incoming calls"). `styles/call-bar.css`; `TWILIO.md`,
"The screen".

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
Enter to send and Shift+Enter for a new line, templates behind a button. (The
header's Send SMS button, which only put the cursor here, went on 2026-09-29.)
The takeover warning appears once there
is text and before the first send, as before; the 160-character limit and the
blocked-number notice are unchanged.

**Ticks and a red "!", not banners - Jeel, 2026-09-28.** The composer used to
show a green "Sent." box after every send, and a red box when EZ Texting
refused one. Both are gone. The thread now says it, the way a phone does:

| The message | In the thread |
|---|---|
| EZ Texting accepted it | Two ticks in the bubble's bottom-right corner |
| EZ Texting refused it | A red "!" beside the bubble, and no ticks. Hover says "Not sent" |

**Two ticks mean "EZ Texting accepted it", not "reached the phone".** That is
Jeel's decision: acceptance is what the send call answers, and nothing tells us
about the phone - we read no delivery reports. So there is no one-tick state.

**A refused message is kept.** The server stores it marked failed
(`db/failed-sends.ts`), for automated messages too - an opener or question 2
that never went out now shows in the thread with its "!", where before it was
only a line in the server log. The box is cleared, as it would be for a sent
message. When nothing is kept - a blocked number, a lead no longer yours - the
text stays in the box and the red error above it still explains why.

A first send still adds "Agent took over - automated questions stopped" to the
thread. `Conversation.render.test.tsx` pins the ticks and the "!".

**The wrap-up is the old actions panel regrouped.** Outcomes are grouped
Positive / No contact / Negative. *(2026-09-28, Jeel: replaced by two buttons,
**Closed** and **DNC** - DNC a button now, not a link, still behind the same
confirm dialog. The groups, the Step N of 3 counter that tracked them and
their styles are gone. `AGENT-WORKSPACE.md`, "Dispositions".)* DNC is a separate red link, not one of the
buttons - it still opens the same confirm dialog. The quick callback chips gained
"Pick time...", which reveals the date field *(2026-09-29: now one set of
choices ending in "Other…" - "Picking a date and time" below)*. "Step N of 3" (since removed) showed which section
still wants something: outcome, then callback or note - the callback is optional,
so it never holds the step back on its own. Save and the unsaved changes guard
are untouched. *(Save & next was removed later the same day - "One button"
below.)*

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
*(2026-10-01: calling is built; the Call button is real - `TWILIO.md`, "The screen".)*

**Checked in the browser, 2026-09-28** - Send SMS focuses the composer;
templates fill it and the takeover warning shows; Send enables and disables with
the text; Pick time reveals the picker; a quick chip sets the callback; choosing
an outcome advances the step; DNC opens the confirm and Cancel leaves the
outcome alone; Save posts note, callback and disposition and clears the form;
Save & next released and opened the next lead (since removed); the timeline page still shows all
three; unclear replies stay unlabelled; a blocked number hides the composer and
Send SMS; Back to queue releases the claim. No console errors.

Agents land on `/queue`; `/admin` lands on Overview. The admin section is behind
`RequireRole`, and every admin endpoint refuses an agent independently - the
guard on the screen is convenience, not security.

## Shared class names - 2026-09-28

The table card, its toolbar and the table inside it began life on the queue and
Admin > Leads, so every page that reused them carried `queue-card`,
`queue__name` or `leads__search` - names that said "queue" on the DNC list. They
were renamed for what they are, with no change to how anything looks (a
before-and-after pixel diff of every page matched):

| Was | Is |
|---|---|
| `queue-card`, `queue-card__toolbar`, `queue-card__search` | `table-card`, `table-card__toolbar`, `table-card__search` |
| `queue__table`, `queue__row`, `queue__row--locked`, `leads__row--new` | `data-table`, `data-table__row`, `data-table__row--locked`, `data-table__row--new` |
| `queue__name`, `queue__phone`, `queue__score`, `queue__source`, `queue__action`, `leads__when` | `cell-name`, `cell-sub`, `cell-strong`, `cell-code`, `cell-action`, `cell-muted` |
| `leads__search`, `leads__select` | `search-input`, `select-input` |
| `leads__total`, `leads__empty`, `leads__pager`, `leads__loading` | `table-card__count`, `table-card__empty`, `table-card__pager`, `loading-block` |

`queue__locked` and `queue__truncated` keep their names: only the queue uses them.

Internal values and screen words still differ in a few places, on purpose:

| Stored or sent | Shown | Why it stays |
|---|---|---|
| conversation `status = 'completed'` | Ready | A database value; renaming it is a migration for no behaviour change. The API's lead status is already `ready` |
| queue tag kind `working` | Working – name | Same word since 2026-09-28 |
| Overview `responded`, `completed` | Replied, Answered all 3 | Field names in one JSON payload, read in one page |

## Picking a date and time - 2026-09-29

Wrap up's "Pick time..." and My Callbacks' Reschedule used
`<input type="datetime-local">`, whose calendar the browser draws in its own
blue and fonts, and which cannot be restyled - Jeel: it did not match the app.
Both now use `components/DateTimeField.tsx`: a field like the other inputs that
opens a small calendar (past days off, today outlined, the chosen day brand
navy) and a time menu in 15-minute steps, with times already gone hidden for
today. The value is the same local-time string the input gave, so nothing that
saves a callback changed. The time menu is still the browser's own list, which
is as plain as the other selects in the app. `DateTimeField.test.tsx`.

**Wrap up's callback is one set of choices - Jeel, the same day.** It was
three quick chips, a "Pick time..." chip on a line of its own, and the date
field below that - three rows, and nothing showed which chip had been chosen.
Now: `In 1 hour`, `Tomorrow 10 AM`, `Tomorrow 3 PM` and `Other…`. The chosen
one is brand navy; pressing it again books nothing. `Other…` opens the
calendar and then shows the date itself ("Sep 30, 3:00 PM"), with Clear in the
panel. The "OPTIONAL" pill beside the heading is gone - every part of Wrap
up is optional, so it said nothing.

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
*Back to queue* releases the claim - and only a claim that is
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
one-agent lock on screen", has both tables. The holder is matched by id since
2026-09-28; before, by name, which two agents sharing a name would break.

**One Save, three writes.** The workspace right column posts a note, a callback
and a disposition to three separate endpoints. Each is append-only, so a partial
failure leaves whatever succeeded; the panel names the part that failed rather
than claiming the whole save went wrong.

**One button: Save - Jeel, 2026-09-28.** Wrap up had a second button, *Save &
next lead*, which saved, released the lead and opened the top unlocked lead in
the queue. It was dropped: nothing moves an agent on to a lead they did not
choose. Save is the primary button.

**Saving an outcome ends the visit - Jeel, 2026-09-29.** With Closed or DNC,
Save releases the lead (on the server) and takes the agent back to the queue,
where the lead is already gone. With only a note or a callback the agent stays
and leaves with *Back to queue*. A closed lead shows Closed as the selected
button with "Closed by Maya · 7:01 PM" beneath it. A lead someone holds is never
closed (`AGENT-WORKSPACE.md`), so the agent holding it starts from clear buttons
and their Closed is always saved. What Save did is a muted
"✓ Saved 7:01 PM" beside the button, and a failure a short red line in the same
place - both replacing a green banner over the panel that read as generic.

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

`npm test` in `frontend/`. Vitest with jsdom, 140 tests (2026-09-29).

Logic first, by agreement - a screen is easy to judge by eye, and a dropped
response or an off-by-one age threshold is not:

| File | Covers |
|---|---|
| `api/usePolling.test.ts` | The polling hook's guarantees, the race guard included |
| `lib/format.test.ts`, `lib/lock.test.ts` | Formatting, and which row action and lock a lead gets |
| `components/Timeline.test.tsx`, `pages/LeadTimelinePage.test.ts` | The timeline's wording, and the summary sidebar |
| `pages/workspace/Conversation.test.ts` | Labelling a reply with the answer it was recorded as |
| `pages/workspace/Conversation.render.test.tsx` | The sent ticks and the red "!" on a refused message |
| `components/QueueStatus.test.tsx` | The queue's four statuses, their icons, a callback's time, and the tier bars |
| `components/DateTimeField.test.tsx` | The date and time picker: the month grid, quarter hours, past days off, Clear, Escape |
| `pages/workspace/LeadHeader.test.ts` | The header's source and Questions wording |
| `pages/workspace/LeadNotes.test.tsx` | The Notes card: newest first, three then Show all, the author, the empty state |
| `pages/workspace/LeadAnswers.test.ts` | The score breakdown's light-blue-to-navy shades |
| `components/SyncStatus.test.tsx` | The EZ Texting sync line, quiet and amber |
| `components/Segmented.test.tsx` | The sliding switcher |
| `styles/type-system.test.ts` | The type scale, duplicate selectors, undefined tokens - "Type system" above |

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

- ~~**Calling.**~~ Built 2026-10-01, Phase 4 - `TWILIO.md`. Outgoing only;
  no recording, transfer or hold.
- **Live push.** Polling stands in for it, deliberately - see above.
- **Export CSV** on the DNC list. In the brief, and it hands a file of phone
  numbers to a browser, so it needs Jeel to ask for it.
- **Previous-lead history** on the timeline. Repeat-lead handling is a future
  item (CLAUDE.md §10), so there is never an earlier lead to show.
- **Force-release.** `POST /api/leads/:id/release` already lets a superadmin
  release anyone's claim, and `AGENT-WORKSPACE.md` promises it, but no screen
  offers it. Today a claim clears only when the agent leaves the workspace.
