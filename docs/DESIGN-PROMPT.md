# Design prompt – Secure Medical Lead Qualification & Call Center App

## What this is

Design the complete web UI for an internal call center application used by a small telehealth company. Leads arrive via SMS automation, get scored, and appear in a queue. Agents call them from the browser, take notes, set callbacks and record outcomes. A superadmin manages agents, scoring rules and sees everything.

This is a **desktop-first internal tool** used 8 hours a day by ~10 agents. Priorities, in order: speed of scanning, zero ambiguity, low visual fatigue, no wasted clicks. It should feel like a professional ops console (think Linear, Front, Intercom inbox) – not a marketing site and not a generic admin template.

Produce high-fidelity designs for every page and state listed below, plus a component library.

---

## Users and roles

| Role | What they do | What they must never see |
|---|---|---|
| **Agent** | Work the queue, call/text leads, add notes, set callbacks, set dispositions, see their own callbacks | Other agents' activity, admin settings |
| **Superadmin** | Everything an agent can do, plus: see all agents' activity, see every lead including ones that never replied, manage agent accounts, edit scoring rules and tiers, edit SMS copy and settings, manage the DNC list | – |

Role is set at login. Navigation adapts to role.

---

## Visual direction

- **Density:** compact. Tables at 36–40px row height. Agents scan dozens of rows; whitespace is the enemy here.
- **Palette:** neutral base (cool grays, white surfaces, one dark navy/slate for the app bar). Colour is reserved for meaning only:
  - **HOT** – red/coral
  - **WARM** – amber
  - **LOW** – slate/gray
  - Success (delivered, completed) – green
  - Danger (DNC, suppressed) – deep red
  - Live/active (call in progress, ticking timers) – a single accent, e.g. teal or blue
- **Typography:** one sans family (Inter or similar). Tabular numerals for scores, timers, phone numbers. 13–14px body in tables, 16px in forms.
- **Iconography:** one consistent line-icon set (Lucide or Phosphor). Icons always paired with a label unless in a dense table.
- **Motion:** minimal. Row highlight on new lead arrival (fade in over 600ms), timer tick, call-state transitions. No decorative animation.
- **Light mode only** for v1. Design tokens should make dark mode possible later.
- **Empty, loading and error states** for every list and panel. Skeleton loaders for tables, inline error banners that don't block the rest of the page.

---

## Global layout

**App shell**
- Top bar, 56px, full width: product mark left ("SM Call Center"), primary nav center, status indicators + user menu right.
- Primary nav items: **Queue**, **My Callbacks**, **Admin** (superadmin only).
- Status indicators (right side): EZ Texting connection (green dot / red dot + label), Twilio connection (green dot / red dot + label), current agent name with avatar initial and role badge.
- No left sidebar. Content is full-width below the top bar with a max content width of ~1440px, centred.

**Global components**
- Toast notifications (bottom-right): new HOT lead arrived, SMS sent, call ended, save confirmed, errors.
- Confirm dialog (destructive actions: mark DNC, deactivate agent, recalculate scores).
- Keyboard shortcuts overlay (`?`): agents will live on the keyboard.

---

## Pages

### 1. Login
- Centred card, product mark, email + password, "Sign in" button.
- Error state: wrong credentials (inline, non-specific).
- Forced password change screen (first login / after admin reset): new password + confirm, strength hint.
- No self-signup, no "forgot password" link in v1 (admin resets passwords).

### 2. Priority Queue (default landing for agents)

**Purpose:** show every responder, sorted by score then freshness, so the newest high-intent lead is always at the top. Updates live as replies arrive.

**Header row**
- Three tier counters as pill-buttons that also act as filters: `HOT 4`, `WARM 7`, `LOW 12`. Selected state shows which tiers are visible.
- Filters: **Source** (multi-select dropdown: e.g. CORE-G-27, CORE-G-31), **Time window** (Last 1h / 24h / 7d / All).
- Search box: name or phone.
- "Live" indicator with last-updated timestamp.

**Table columns** (in this order)
1. **TIER** – coloured badge (HOT / WARM / LOW)
2. **LEAD** – first name + last initial, bold
3. **STATE** – 2-letter US state or "–"
4. **INTEREST** – Supplements / Telehealth/Rx / Both / –
5. **TIMING** – Today / This week / Researching / –
6. **PREFERENCE** – Call me now / Text me / Contact me later / –
7. **SCORE** – number, right-aligned, tabular
8. **AGE** – `m:ss` since lead arrived, ticking live. Turns amber past 5 min, red past 15 min for HOT.
9. **SOURCE** – partner code, monospace
10. **STATUS** – a tag with one of:
   - `New`
   - `Attempted 1x` / `Attempted 2x`
   - `In progress – {agent name}` (lead is locked)
   - `Callback {time}`
   - `Needs review` (invalid replies, agent must read raw text)
   - `Stalled at Q2` / `Stalled at Q1` (partial responder)
   - `Inbound reply` (lead texted after conversation ended – unread indicator)
   - `Seen before, stopped at Q2` (resold lead with history) - *2026-09-19: does not occur until repeat-lead handling is built, which is deferred until after Week 4.*
11. **Actions** – "Open" button; on hover, quick "Call" and "SMS" icons.

**Row behaviour**
- Click row → opens Agent Workspace for that lead.
- Locked rows (In progress by another agent) are visually muted and not clickable, with a tooltip.
- New rows animate in at their sorted position.
- Rows with `Inbound reply` show a small unread dot.

**States:** loading skeleton, empty ("No leads in this view"), connection lost banner ("Live updates paused – reconnecting").

### 3. Agent Workspace (single lead)

**Purpose:** one screen. See who the lead is, what they said, and call, text, note, schedule and disposition without leaving the page.

**Layout:** three columns on ≥1280px.
- **Left (30%)** – Lead card + actions
- **Center (40%)** – Timeline
- **Right (30%)** – Note, Callback, Disposition, Save

**Lead card**
- Name (large), tier badge + score.
- Phone (formatted, copy button), State, Lead age (ticking), Source.
- Three answer chips: `Interest: Both` · `Timing: Today` · `Prefers: Call me now`.
- Score breakdown, small text: `Responded +10 · Completed +10 · Both +15 · Today +30 · Call now +35`.
- Flags row when relevant: `Seen before` (link to previous lead), `Needs review` (shows raw replies), `DNC` (blocks all actions), `Inbound reply` (unread).
- "Back to queue" and "Next lead" links at the top.

**Actions panel**
- **CALL** button (primary, large). States:
  - Idle: "Call (602) 555-0142"
  - Connecting: spinner, "Connecting…"
  - Active: green state, live timer `00:00`, Mute, Hang up. Shows "Calling from (480) 555-0100 · browser call".
  - Ended: "Call ended · 2:14" with outcome auto-filled where possible (No answer / Completed).
  - Disabled with reason: lead is DNC, or Twilio disconnected.
- **SMS** button → opens inline compose (textarea, character count, send). Template dropdown with 3–4 canned messages (e.g. "Missed you, I'll try again…").

**Timeline (center)**
- Vertical list, newest at bottom, auto-scrolls to latest.
- Entry types, each with a distinct left-edge icon/colour:
  - `SYS` – system events ("Lead received from CORE-G-27", "Scored 100 · HOT · queued", "Conversation expired")
  - `SMS` – outbound automated message (shows the text, delivery status: sent / delivered / failed)
  - `IN` – inbound reply (shows raw text; highlighted if unparsed)
  - `AGENT SMS` – manual message from an agent, with agent name
  - `CALL` – "Outbound call by Michael · no answer · 0:34"
  - `NOTE` – agent note, quoted, with author
  - `CB` – callback scheduled/completed
  - `DISP` – disposition set
- Timestamps right-aligned; day separators.

**Right column**
- **Note** – textarea, auto-saves draft, "Add note".
- **Callback** – date + time picker, quick chips (In 1h / Tomorrow 10am / Tomorrow 3pm), "Assign to" (defaults to me; superadmin can pick any agent).
- **Disposition** – single-select as a segmented/radio group: `Interested` · `Callback set` · `No answer` · `Voicemail` · `Not interested` · `Wrong number` · `DNC`. DNC requires confirm dialog and shows a red warning ("Suppresses this number for SMS and calls everywhere").
- **Save** and **Save & next lead** (primary). Save & next loads the next highest lead automatically.
- Unsaved-changes guard when navigating away.

### 4. Lead Timeline (read-only detail)

**Purpose:** full history of one lead, opened from the queue, a callback, or a report. Same timeline component as the workspace, but full-width with a summary sidebar.

**Header:** name, tier + score, state · phone · source, Call and SMS buttons (open the workspace).

**Timeline:** as above, full history across all lead records for this phone (resold leads show earlier history in a collapsed "Previous lead – Jun 2026" section).

**Summary sidebar**
- Current status (e.g. Callback pending)
- Attempts (n calls, n SMS)
- Last contact (timestamp + direction)
- Next action (e.g. Callback 3:00 PM · Michael)
- Consent ref (partner reference if present, else "–")
- DNC: Yes/No
- Dispositions list (date · value · agent)
- Duplicate check: "This number has not been seen before" or "Linked to earlier lead (Jun 2026)" with link. *(2026-09-19: always the first, until repeat-lead handling is built.)*

### 5. My Callbacks

**Purpose:** the agent's scheduled callbacks.

- Tabs: **Today** · **Upcoming** · **Overdue** (overdue count as a red badge)
- Table: Time, Lead (name + tier), Phone, Note excerpt, Source, Actions (Open / Call / Reschedule / Mark done).
- Overdue rows tinted.
- Superadmin sees an "Agent" filter to view any agent's callbacks.

### 6. Admin (superadmin only)

Left sub-navigation within the page: **Overview** · **Leads** · **Scoring** · **Messages** · **Agents** · **DNC list** · **Settings**.

**6a. Overview**
- KPI cards for the selected period (Today / 7d / 30d): Leads received, Responded %, Completed %, HOT count, Calls made, Reached %, Callbacks set, DNC added.
- Funnel bar: Received → Responded → Completed → Called → Interested.
- Per-agent table: Agent, Calls, Reached, Avg call length, Dispositions breakdown (mini bar), Callbacks pending.
- Recent activity feed (all agents): "Michael set Interested on Jordan M.", etc.
- Live system status: last poll time, last inbound webhook, worker health.

**6b. Scoring rules and tiers**
- **Scoring rules table** – editable inline:
  - Response · Responded to opening SMS · `10`
  - Completion · Answered all three · `10`
  - Interest · Supplements `5` / Telehealth/Rx `10` / Both `15`
  - Timing · Today `30` / This week `20` / Just researching `5`
  - Preference · Call me now `35` / Text me `25` / Contact me later `10`
  - Footer: "Maximum possible: 100" (auto-computed).
- **Tier thresholds** – three editable ranges: HOT 75–100, WARM 45–74, LOW 1–44. Validation: contiguous, no overlap.
- **Preview panel** – 6 sample combinations recomputed live as values change (e.g. "Both · Today · Call me now → 100 HOT").
- Buttons: **Save rules** (primary), **Recalculate existing** (secondary, with confirm and progress).
- Unsaved changes indicator.

**6c. Messages (SMS copy)**
- Editable text for: Opener (Q1), Q2, Q3, Completion message, Clarification message, Review message, STOP confirmation.
- *Update 2026-09-19:* the clarification is three messages, one per question, each repeating that question's options - edit them as three fields. The STOP confirmation is sent by EZ Texting, not by this app, so it is not editable here; show it read-only with that explanation or leave it out. See `docs/STATE-MACHINE.md`.
- Each field shows live character count and segment count; warning when over the configured limit (130 or 160).
- Placeholder chips: `{first_name}`.
- Phone-frame preview on the right showing the full happy-path conversation with current copy.

**6d. Agents**
- Table: Name, Email, Role, Status (Active / Inactive), Last login, Actions.
- "Add agent" drawer: name, email, role, generates a temporary password shown once.
- Row actions: Reset password (shows temp password once), Deactivate / Reactivate, Change role.

**6e. DNC list**
- Table: Phone, Reason (SMS STOP / Agent DNC / Imported), Added by, Date.
- Search by phone. Add manually. Export CSV.
- No delete in v1 (compliance) – show a note explaining this.

**6f. Settings**
- Conversation expiry (days, default 7).
- Delivery type (Standard 130 / Express 160) – affects message limits.
- Lead group filter (EZ Texting group name to poll).
- Poll interval (seconds, 30–60).
- Twilio caller ID number.
- Agent SMS templates (list, add/edit/remove).

**6g. Leads (all leads)** – *added 2026-09-14*

**Purpose:** every lead the poller has pulled in, whether or not they replied. The Priority Queue shows only responders, because agents should spend their time on people who texted back; this page shows everyone else too, so a superadmin can confirm leads are arriving and see where they drop off. It sits under Admin, not in the queue, so non-responders never bury HOT leads for agents.

- **Status tabs** with counts, each a filter:
  - `All`
  - `Awaiting reply` – conversation open, no answer yet
  - `In progress` – conversation open, answered at least one question
  - `Completed` – answered all three, scored
  - `Needs review` – invalid reply twice
  - `Opted out` – replied STOP, opted out in EZ Texting, or on the DNC list
  - `Expired` – no reply within the expiry window, or replaced by a newer delivery
- **Filters:** Source (multi-select), Received (Last 1h / 24h / 7d / 30d / All). **Search:** name or phone.
- **Table columns:** Received (date and time, tabular), Lead (first name + last initial), Phone (formatted), Source (monospace), Status (tag, as above), Step reached (`–`, `Q1`, `Q2`, `Q3`), Score and tier (only when completed, else `–`), Last activity (time of the most recent SMS in or out, with direction).
- **Default sort:** newest received first.
- **Row click** opens the Lead Timeline (page 4) for that lead.
- **Read-only.** No Call or SMS buttons here; working a lead happens in the Agent Workspace. `Opted out` rows are tinted with the Danger colour and say so.
- **Pagination:** 50 rows per page, page controls at the bottom, total count at the top. At 50–100 leads a day the list passes 30,000 rows within a year.
- **Live:** new leads appear at the top without a refresh, with the same 600ms row highlight as the queue.
- **States:** loading skeleton; empty ("No leads in this view"); a warning banner when the last successful poll is older than three poll intervals ("No new leads pulled since 2:14 PM – check the worker").

---

## Component library to deliver

- App bar, nav item (with active state), status dot + label, user menu
- Buttons: primary / secondary / ghost / danger, sizes sm/md/lg, with icon variants and loading state
- Tier badge (HOT / WARM / LOW), status tag (all queue statuses), delivery-status chip
- Data table: sortable header, row hover, locked row, selected row, skeleton row, empty row
- Filter pill (count + toggle), dropdown multi-select, segmented control, search input
- Live timer text (ticking, with amber/red thresholds)
- Lead card, score breakdown line, answer chips
- Call control block (all five states)
- SMS compose (with template picker and char count)
- Timeline list + every entry type
- Note editor, callback picker (with quick chips), disposition group
- Form inputs, textarea with char/segment counter, number input, date-time picker
- Phone-frame SMS preview
- KPI card, funnel bar, mini bar chart
- Drawer (right), modal/confirm dialog, toast, inline banner (info / warning / error), tooltip
- Keyboard shortcut hint

---

## Interaction details that matter

- Every table row is keyboard-navigable (↑ ↓ Enter).
- In the workspace: `C` = call, `S` = SMS, `N` = note, `1–7` = disposition, `Cmd/Ctrl+Enter` = Save & next.
- Ticking timers must not cause layout shift – fixed-width tabular numbers.
- When a lead gets locked by another agent while you're viewing the queue, its row updates in place with the tag – no full refresh.
- Toasts never cover the Call button.
- All destructive actions require confirmation and state the consequence in plain words.

---

## Deliverables

1. Component library (Figma components with variants and tokens: colour, type, spacing, radius, shadow).
2. Every page above at 1440px, including all listed states (loading, empty, error, locked, unsaved changes).
3. Agent Workspace at 1280px and 1024px (columns stack: lead card + actions above, timeline below, right column becomes a bottom sheet).
4. A clickable prototype covering: Login → Queue → open HOT lead → Call → Disposition → Save & next.
5. A short redlines/spec page for the queue table and call control block.

Sample names, phone numbers and sources are fictional. Do not include any medical content, symptoms, conditions or medication names anywhere in the UI or sample data.
