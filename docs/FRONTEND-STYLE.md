# Frontend style

The frontend's design system, to look things up in: the type scale, the colour,
space and layout tokens, what `frontend/src/styles/type-system.test.ts` enforces,
the shared class names, the shared components and the status icons. The tokens
are `frontend/src/styles/tokens.css`; the rules are the stylesheets
`frontend/src/styles/global.css` imports, one per area; the components are
`frontend/src/components/`. How the app is put together is `FRONTEND.md`.

## Type system

Five sizes and three weights, named by role. **Pick the role, not the size.**
There is no token for 13px, deliberately: one pixel from 12 and 14, it made text
meant to match look slightly off. Every step is at least 2px from the next, so a
difference in size is always a difference in meaning. Body is 14px everywhere,
forms included.

| Role | Size token | Size | Weight token | For |
|---|---|---|---|---|
| heading | `--text-heading` | 20px | `--weight-semibold` | page titles, the lead's name |
| title | `--text-title` | 16px | `--weight-semibold` | card titles |
| section | `--text-body` | 14px | `--weight-semibold` | a heading inside a card |
| body | `--text-body` | 14px | `--weight-regular` | cells, buttons, forms, messages |
| label | `--text-small` | 12px | `--weight-semibold`, uppercase, `--tracking-label` | column heads, captions, badges |
| meta | `--text-small` | 12px | `--weight-regular` | timestamps, hints, counts |
| display | `--text-display` | 24px | `--weight-bold` | scores and KPI figures |

| Token | Value |
|---|---|
| `--weight-regular` · `--weight-semibold` · `--weight-bold` | 400 · 600 · 700 |
| `--tracking-label` | 0.06em |
| `--font-sans` | `'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

- **Badges are labels**: 12px semibold uppercase, the same as the column head
  above them - never the same size and capitals at a different weight.
- **Headings default to semibold**, in a base rule in `base.css` (`h1` to `h4`,
  `strong`, `b`), so a rule that forgets its weight gets the heading weight
  rather than the browser's bold.
- Scores, timers and phone numbers use tabular figures: the `.tabular` class.

## Colour

Neutral cool greys, white surfaces, the dark navy app bar, and colour kept for
meaning. "Blue" on screen means the brand navy, `#0f2942` - the app bar, a
chosen option, a hovered action. The link blue, `--color-accent`, is for links
only; no selected tab uses it.

| Token | Value | For |
|---|---|---|
| `--color-bg` | `#f4f6f9` | the page |
| `--color-surface` | `#ffffff` | cards, inputs |
| `--color-surface-muted` | `#f8fafc` | a quieter surface |
| `--color-surface-hover` | `#f1f5f9` | a hovered row, the segmented track, a locked row's grey |
| `--color-border` · `--color-border-strong` | `#e2e8f0` · `#cbd5e1` | borders |
| `--color-text` · `--color-text-muted` · `--color-text-subtle` | `#0f172a` · `#64748b` · `#94a3b8` | text, by step |
| `--color-appbar` | `#0f2942` | the app bar |
| `--color-appbar-text` · `--color-appbar-text-active` | `#b6c3d1` · `#ffffff` | its links |
| `--color-appbar-accent` | `#5eead4` | the logo's letters on the sign-in pages (`.auth-brand__logo`) |
| `--color-call-live` | `#22c55e` | a connected call's dot on the dark call bar; the "Taking calls" switch when on |
| `--color-primary` · `--color-primary-hover` | `#0f2942` · `#1b3a5c` | primary buttons, a chosen option, a hovered action |
| `--color-on-primary` | `#ffffff` | text on the navy |
| `--color-accent` · `--color-accent-soft` | `#1d4ed8` · `#eff6ff` | links; a new row's highlight |
| `--color-hot` · `--color-hot-soft` | `#dc2626` · `#fee2e2` | Hot |
| `--color-warm` · `--color-warm-soft` | `#b45309` · `#fef3c7` | Warm |
| `--color-low` · `--color-low-soft` | `#475569` · `#e2e8f0` | Low |
| `--color-success` · `--color-success-soft` | `#15803d` · `#dcfce7` | done, delivered |
| `--color-danger` · `--color-danger-hover` · `--color-danger-soft` · `--color-danger-border` | `#b91c1c` · `#991b1b` · `#fef2f2` · `#fecaca` | blocked, opted out, destructive actions |
| `--color-warning` · `--color-warning-soft` · `--color-warning-border` | `#92400e` · `#fffbeb` · `#fde68a` | amber: overdue, stale, a missed transfer |

Light mode only. Everything visual reads from these variables, so a dark theme
is a matter of redefining them.

## Space, radius, shadow and layout

| Token | Value |
|---|---|
| `--space-1` to `--space-6`, `--space-8` | 4, 8, 12, 16, 20, 24 and 32px |
| `--radius-sm` · `--radius-md` · `--radius-lg` | 4 · 6 · 10px |
| `--shadow-sm` · `--shadow-md` · `--shadow-lg` | `0 1px 2px` · `0 4px 12px` · `0 16px 40px`, in the text colour at 0.06, 0.08 and 0.18 |
| `--focus-ring` | `0 0 0 3px` of the link blue at 0.3 - buttons and controls |
| `--focus-ring-field` | `0 0 0 3px` of the navy at 0.12 - text fields, so a focused form reads as one colour |
| `--appbar-height` | 56px |
| `--content-max` | 1440px - the content is centred and capped here |
| `--row-height` | 40px |
| `--call-bar-raise` | 84px - a call bar's height and the gap above it; a second bar docks above the first (`call-bar.css`) |

- **The admin layout's content column is `minmax(0, 1fr)`** (`.admin`,
  `tables.css`). A bare `1fr` cannot be narrower than its widest content, so one
  long row stretched the whole page sideways instead of scrolling in its card.
- **`.card` alone has no global style.** The admin pages get theirs from
  `.table-card`; the timeline page's cards render flat; the workspace scopes its
  rule to `.workspace .card`. A global `.card` rule would restyle screens nobody
  asked to change.

## What the type-system test enforces

`frontend/src/styles/type-system.test.ts` reads `tokens.css` and every stylesheet
`global.css` imports, and fails on:

| Check | Why |
|---|---|
| A stylesheet in `src/styles/` not imported by `global.css` exactly once | A file it does not read is a file it does not check |
| Fewer than 100 rules read, or no `font-size` at all | A test reading an empty string passes every "no strays" check over nothing - "really loaded" |
| Not exactly the five size tokens, or two sizes less than 2px apart | The scale stays five deliberate steps |
| Not exactly the three weight tokens | |
| A `font-size` other than a size token or `inherit` - no px, em or rem | Fractions like 12.48px came from `0.85em` nested inside other text |
| A `font-weight` other than a weight token or `inherit` | |
| An uppercase caption that is not 12px, semibold and `--tracking-label` | Captions had two letter-spacings and two weights between them |
| A property declared twice in one rule | |
| The same selector defined twice at the top level (a repeat inside a media query is the point, and allowed) | A second `.avatar`, added for the workspace, restyled the app bar on every page |
| The heading base rule not pinned to `--weight-semibold` | |
| A `var()` that no stylesheet defines | The browser drops an unknown variable silently |

It imports the stylesheets with `?raw`, not `node:fs`: this is a browser app
with no Node types, so `node:fs` would fail `tsc` and with it `npm run build`.
Vitest replaces CSS with an empty string unless told otherwise, `?raw`
included, so `vite.config.ts` opts every file under `src/styles` in (`css:
{ include }`).

`global.css` is only `@import`s. Their order is the cascade, so a later file can
override an earlier one: `base`, `controls`, `auth`, `shell`, `tables`,
`timeline`, `callbacks`, `admin`, `workspace`, `call-bar`, `incoming-call`.
`tokens.css` comes first, from `main.tsx`.

## Shared class names

The table card, its toolbar and the table inside it are shared by every list
page - the queue, Admin > Leads, My Callbacks, the DNC list, Overview's tables.
Their names say what they are, not which page they began on.

| Class | Is |
|---|---|
| `table-card`, `table-card__toolbar`, `table-card__search` | The card holding a list, its toolbar of switcher, search and filters, and the search's place in it |
| `table-card__toolbar--scroll` | A toolbar holding one long switcher: too wide for its card, it scrolls sideways inside the card rather than wrapping - the page itself never scrolls sideways |
| `table-card__count`, `table-card__empty`, `table-card__pager`, `loading-block` | The total, the empty state, the page controls, the loading state |
| `data-table`, `data-table__row`, `data-table__row--locked`, `data-table__row--new` | The table, a row, a locked row (grey all the way across), a new row (a 600ms highlight in `--color-accent-soft`) |
| `cell-name`, `cell-sub`, `cell-strong`, `cell-code`, `cell-action`, `cell-muted` | The lead's name, the line under it (the phone), a strong number (the score), a code (the source), the action column (centred), a quiet cell |
| `a.cell-name` | The name as a link to the row's page, so a row opens from the keyboard - Tab to it, Enter - looking as the name always did. Not on a locked row |
| `search-input`, `select-input` | The search box and a filter's select |
| `is-switching` | Content being replaced by a switch: faded to 0.55 and not clickable until the new data lands (`FRONTEND.md`, "The polling hook") |
| `.table th.right` | A right-aligned column's heading, over its numbers - SCORE and WAITING |
| `tabular` | Tabular figures |

Two keep a page's name, because only the queue uses them: `queue__locked` and
`queue__truncated`.

An action in a table - Pick up, Resume, View - is a secondary button that fills
with the navy, white text, on hover (`.cell-action .btn--secondary`), the same
look as a chosen option.

## Shared components

`frontend/src/components/`. No UI framework: these are the whole kit.

| Component | What it is |
|---|---|
| `Button.tsx` | Variants `primary`, `secondary`, `ghost`, `danger`, `danger-ghost`; sizes `sm`, `md`, `lg`; `loading` shows a spinner and disables it; `block` for full width |
| `Badge.tsx` | A label-role badge; tones `neutral`, `navy`, `success`, `muted`, `warning`, with an optional dot |
| `Banner.tsx` | An inline banner that does not block the page; tones `error`, `warning`, `info`, `success` |
| `Spinner.tsx` | The loading state on every list but Admin > Agents, which draws skeleton rows (`.skeleton`) |
| `TextField.tsx` | A labelled text input |
| `Modal.tsx`, `Drawer.tsx` | A dialog, and a panel from the right (Add agent). Both take focus on opening - to a control that asked for it, else the first field, else the first control - keep Tab inside, close on Escape and give focus back to what opened them (`useDialogFocus`, `useEscape` in `useDismiss.ts`) |
| `ConfirmDialog.tsx` | A confirm step in a `Modal`, for an action that cannot be taken back - deactivating an account, Seri's switch |
| `OneTimeSecret.tsx` | A temporary password, shown once, in a panel Escape and a backdrop click do not dismiss (`AUTH.md`) |
| `AuthLayout.tsx`, `BrandMark.tsx` | The sign-in pages' layout and the product mark |
| `Segmented.tsx` | The sliding navy switcher - below |
| `DateTimeField.tsx` | The date and time picker - "Picking a date and time", below |
| `RowMenu.tsx` | A row's "⋯" actions menu - below |
| `StatusIcon.tsx` | Every status icon, one set for every screen - "Status icons", below |
| `QueueStatus.tsx` | The queue's STATUS cell: an icon and the words (`QUEUE.md`, "The tag") |
| `LeadStatus.tsx` | An Admin > Leads status: an icon and the words (`ADMIN-LEADS.md`) |
| `TierSignal.tsx` | A tier as signal bars and the word - three bars Hot, two Warm, one Low, a hyphen for none. The bars rank the tiers without colour; the word means the tier never depends on reading an icon |
| `LockIcon.tsx` | The padlock on a locked queue row, drawn in the text colour |
| `LiveStatus.tsx` | "Live · updated just now", "updated 12s ago", or "Live updates paused" when the last poll failed - on every screen that updates by itself. Its own one-second clock (`lib/useSecond.ts`), so it counts up without the page re-rendering |
| `SyncStatus.tsx` | "Synced with EZ Texting 1m ago" under the Live label on Admin > Leads; amber after three poll intervals with no poll (`ADMIN-LEADS.md`) |
| `Timeline.tsx`, `CallTranscript.tsx`, `CallAnswers.tsx`, `SeriConversation.tsx` | The timeline and what folds under a call - `TIMELINE.md` |
| `useDismiss.ts` | `useEscape` and `useDialogFocus` |

### The segmented control

`Segmented.tsx`: a row of mutually exclusive options on a grey track
(`--color-surface-hover`), the chosen one in the navy with white text - the same
look as a hovered action, so "selected" and "about to act" read alike. One
component for every switcher: the queue's tier, Admin > Leads' status, the DNC
list's state, My Callbacks' tab, Overview's period, Configuration's tab, the Add
agent drawer's role.

- **The navy slides.** It is a thumb behind the options that glides to the
  chosen one in 220ms (`cubic-bezier(0.2, 0, 0, 1)`). Its position is measured,
  because options differ in width and a count ("All 7" becoming "All 12")
  changes them; a `ResizeObserver` re-measures when an option moves without the
  choice changing.
- The thumb is placed before the first paint and only animates after, so a page
  never opens with it sweeping in. Until it is placed the chosen option carries
  the navy itself, so white text never sits on the grey track.
- `prefers-reduced-motion` switches without the slide.
- **An option never wraps** (`white-space: nowrap`). The `dense` variant has
  12px sides instead of 16, for a row of many - Admin > Leads. A row still wider
  than its card scrolls sideways inside it (`table-card__toolbar--scroll`).
- Each option is a `role="radio"` in a `role="radiogroup"`; a count sits beside
  its label, a step quieter (`segmented__count`).

### Picking a date and time

`DateTimeField.tsx`, in place of `<input type="datetime-local">`, whose calendar
the browser draws in its own blue and fonts and which cannot be restyled. A
field like the other inputs that opens a small calendar - a six-week month grid,
Sunday first, past days off, today outlined, the chosen day in the navy - and a
time menu in 15-minute steps, with times already gone hidden for today. The time
menu is the browser's own select, as plain as the other selects in the app.

- The value is the string the input gave: local time, no zone,
  `2026-09-29T15:30`, or empty for none - so nothing that saves a callback had to
  change.
- Two looks: `field`, an input-like box (My Callbacks' Reschedule), and `chip`,
  one of Wrap up's callback choices - navy once it holds a date, which it then
  shows in place of its label. Clear, in the panel, empties it.
- The panel is fixed-position, like `RowMenu`'s, so a card with hidden overflow
  cannot clip it, and closes on Escape, a click outside, a scroll or a resize.

### The row menu

`RowMenu.tsx`: a "⋯" button opening a row's actions - Admin > Agents, and My
Callbacks' Reschedule and Mark done. It goes navy on hover like every other
action; a `danger` item is red. The panel is `position: fixed`, placed from the
button when it opens, because `.table-wrap` scrolls sideways and clips anything
positioned inside it - the last row's menu would be cut off. It closes on
Escape, an outside click, a scroll or a resize, since a fixed panel would
otherwise float away from its row. Its panel and items are the app bar's user
menu's styles.

## Status icons

`StatusIcon.tsx`: inline SVG outlines on a 24-unit grid, stroked in the text
colour like the padlock, so a muted or locked row greys its icon with its words.
Each state has one picture on every screen, and no picture means two things -
no dot is drawn anywhere.

| Icon | Name | Where | Means |
|---|---|---|---|
| Clock | `clock` | Queue: Callback – name · time (bold once a promised call back is due); Admin > Leads: Awaiting reply; Agents: Pending first sign-in, in amber | Waiting on a time, or on them |
| Chat bubble | `chat` | Admin > Leads: Answering | A conversation under way |
| Empty circle | `circle` | Admin > Leads: Ready | Not started |
| Half-filled circle | `half` | Queue and Admin > Leads: Working | Started, not finished |
| Ticked circle | `check` | Admin > Leads: Closed; DNC list: Released; Agents: Active | Finished |
| Message box, arrow in | `inbound` | Queue: Inbound reply, bold | A text has come to us and nobody has read it |
| Handset, arrow turned away | `missed` | Queue: Missed call, bold | The lead rang and nobody answered |
| Handset | `phone` | Queue: Wants a call - not bold, though it ranks with Missed call when it is a "yes" nobody took | They asked for a call |
| Price tag | `tag` | Admin > Leads: Offers, muted | Offers only |
| Circle with a line through it | `minus` | Admin > Leads: Not interested, muted | Said no to everything |
| Warning triangle | `warning` | Queue and Admin > Leads: Needs review | A person has to look at the replies |
| Barred circle | `ban` | Admin > Leads: Opted out, red; DNC list: Blocked, red; Agents: Inactive, muted | Blocked |
| Hourglass | `hourglass` | Admin > Leads: Expired, muted | Ran out of time |
| Shield | `shield` | Agents: Superadmin | Can manage the others |
| Person | `person` | Agents: Agent | An agent's account |

Which status a lead has, and which wins, is the owning doc's: `QUEUE.md`, "The
tag"; `ADMIN-LEADS.md`, "Status". Bold is
`.status--strong`, for the statuses where the lead is waiting on us.

## How to add an entry

1. **A token**: add it to `tokens.css`, and a row here. A new size or weight is a
   new role - the test fails on a sixth size or a fourth weight until its list
   is changed, which is the point.
2. **A stylesheet**: add the file to `src/styles/` and an `@import` of it to
   `global.css`, in the place its cascade needs; the test fails until both are
   there. Update the import order above.
3. **A shared class or component**: name it for what it is, not the page it
   began on; add its row here.
4. **A status icon**: add it to `StatusIconName` and its drawing in
   `StatusIcon.tsx`, and a row to "Status icons" - one picture per meaning.

## History

- 2026-11-27 · Written, from `FRONTEND.md`'s type system, shared class names,
  date picker and status-icon sections, each value checked against `tokens.css` ·
  the design system in one reference doc · D28
- 2026-11-24 · `ConfirmDialog` moved out of the Agents page into `components/`,
  for Seri's switch on Configuration - one copy for both · Seri's switch
- 2026-11-23 · Dialogs take focus and give it back (`useDialogFocus`, `Modal` and
  `Drawer`); the lead's name a link on the queue, Admin > Leads and the DNC list
  (`a.cell-name`), so every row opens from the keyboard; `LiveStatus` on
  `useSecond` · review Q8, Q7
- 2026-10-06 · Offers made ten Admin > Leads tabs and Not interested eleven; with
  three-digit counts "Awaiting reply" broke onto two lines inside its 32px track
  and spilled out of it. Options stopped wrapping, Admin > Leads took the `dense`
  variant, the toolbar scrolls inside its card, and the admin content column
  became `minmax(0, 1fr)`. Measured in the running app, with every option 32px
  tall and the page never scrolling sideways: at single-digit counts the row was
  1,119px - scrolling in its card at 1280 and 1366px, fitting at 1440px and
  wider; with counts up to 1,284 it was 1,328px and scrolled in its card at
  every width. If that proves awkward, the next step is fewer tabs, not smaller
  ones. The same day Offers and the queue's Wants a call got their own icons:
  they had borrowed the inbound message box and the chat bubble, which already
  meant an unread text and Answering · found in review
- 2026-09-29 · `DateTimeField` in place of `datetime-local`, for Wrap up and My
  Callbacks' Reschedule · Jeel: the browser's calendar did not match the app
- 2026-09-28 · Each queue status its own icon, from Jeel's mockup: earlier that
  day each had a dot - first a filled dot, a ring or a square, then a plain dot,
  Needs review's in a warm colour; Jeel: a dot said only "something", an icon
  says which. `StatusIcon`, `LiveStatus` and `LeadStatus` moved out of the queue
  so Admin > Leads uses the same parts; `QueueStatus` draws from `StatusIcon` ·
  the two screens cannot drift apart
- 2026-09-28 · The shared classes renamed for what they are, with a pixel diff of
  every page matching before and after: `queue-card`, `queue-card__toolbar`,
  `queue-card__search` became `table-card`, `table-card__toolbar`,
  `table-card__search`; `queue__table`, `queue__row`, `queue__row--locked`,
  `leads__row--new` became `data-table`, `data-table__row`,
  `data-table__row--locked`, `data-table__row--new`; `queue__name`,
  `queue__phone`, `queue__score`, `queue__source`, `queue__action`,
  `leads__when` became `cell-name`, `cell-sub`, `cell-strong`, `cell-code`,
  `cell-action`, `cell-muted`; `leads__search`, `leads__select` became
  `search-input`, `select-input`; `leads__total`, `leads__empty`,
  `leads__pager`, `leads__loading` became `table-card__count`,
  `table-card__empty`, `table-card__pager`, `loading-block` · names that said
  "queue" on the DNC list
- 2026-09-28 · `Segmented`, one component with a sliding thumb, in place of the
  markup the queue and the Add agent drawer each wrote by hand - measured, the
  thumb passed 20, 159, 204 and 219px on its way from 2px to 228px · Jeel: "not
  smooth". Admin > Leads' underline tabs in the link blue became the same
  switcher, and My Callbacks' too; the underline-tab styles went with them ·
  Jeel: blue means the brand navy
- 2026-09-28 · Removed as unused: `.kpi`, `.funnel`, `.overview__*` (the System
  card's newer `.overview__detail` stays), `.config__title`, `.config__choice`
  (Overview rebuilt), `.table__actions`, `.table__name` (Agents redesigned) ·
  the pages were rebuilt in the card style
- 2026-09-28 · `.table th.right`: a right-aligned column's heading had stayed on
  the left - `.table th` outranked `.right` - so SCORE and WAITING sat away from
  their numbers · found building Admin > Leads
- 2026-09-28 · `--color-surface-alt` was used in seven places and defined nowhere,
  so the browser dropped every one - queue row hover, a locked row's grey, the
  quick-callback chips' hover, Config's message boxes and the Overview funnel
  track had never rendered. They use `--color-surface-hover`, and the test fails
  on any `var()` not defined · found building the queue
- 2026-09-28 · Checked for horizontal overflow on all nine screens at 1280, 1366,
  1440 and 1920px: Config (the scoring options side by side in a nowrap cell,
  240px past the window) and Agents (three row actions side by side, past a
  1366px laptop) already overflowed on `dev`. Scoring options stack; row actions
  and Config's row labels wrap. The shared table rules lost two bugs: the last
  row's divider and the hover highlight applied to data cells but not row labels,
  leaving half a line under "Maximum possible" · found while measuring the type
- 2026-09-28 · The type system: measured before, ten font sizes across nine
  screens where five would do - three fractions, 11.9, 12.48 and 13.6px, from
  `0.85em` and `0.85rem` resolving against whatever they sat inside, and 12, 13
  and 14px all in heavy use; card titles in two styles, 14px on the workspace
  and a 12px uppercase caption on Overview, Config and the timeline sidebar,
  which borrowed a label class. HOT / WARM / LOW badges had been 12px bold (700)
  under a TIER heading at 12px semibold (600). Five sizes and three weights,
  enforced by `type-system.test.ts`, each check proven by breaking a stylesheet
  on purpose. An earlier version of the test read an empty string and passed
  four checks over nothing; the "really loaded" check followed. The one
  3,100-line stylesheet was split into one file per area the same day ·
  supersedes the brief's 13-14px tables and 16px forms
