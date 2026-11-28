# Auth

Email and password sign-in for agents and superadmins. There is no self-signup
and no forgot-password: a superadmin creates accounts and resets passwords. The
code is `backend/src/api/auth/`, `backend/src/api/users/`, `backend/src/db/users.ts`
and `backend/src/cli/create-superadmin.ts`; on the frontend `frontend/src/auth/`,
`frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/ChangePasswordPage.tsx`
and the Agents page, `frontend/src/pages/admin/AgentsPage.tsx`.

## How it works

### The first account

Nobody can sign in to create an account until one exists, so the first
superadmin is made from the terminal with `create-superadmin` - the command is
in `RUNNING.md` for a laptop and `DEPLOY.md` for the server. It prints a
temporary password once; signing in with it leads straight to setting a
password of one's own, before anything else works.

### Endpoints

All under `/api`, the only prefix Caddy forwards to the API.

| Method | Path | Who | Does |
|---|---|---|---|
| POST | `/api/auth/login` | anyone | Checks email and password, sets the session cookie |
| POST | `/api/auth/logout` | anyone | Ends the session on the server and clears the cookie |
| GET | `/api/auth/me` | anyone | The signed-in user, or `{ "user": null }` |
| POST | `/api/auth/change-password` | signed in | Needs the current password. Signs out other devices |
| GET | `/api/users` | superadmin | Lists accounts |
| POST | `/api/users` | superadmin | Creates an account; returns a temporary password once |
| PATCH | `/api/users/:id` | superadmin | Changes `name`, `role` or `isActive` |
| POST | `/api/users/:id/reset-password` | superadmin | A new temporary password, returned once |

Errors are `{ "error": "<code>", "message": "<text>" }`. The frontend switches
on `error` and shows `message` as it is.

`/api/auth/me` answers 200 with `null` when nobody is signed in. Every page
load asks it before anyone has signed in, so "nobody" is the normal answer
there; a 401 would put a red network error in the browser console on every
visit to the sign-in page.

### How a session works

Signing in sets a JWT in a cookie named `sm_session`. The token holds the
user's id and their `session_version` at the moment of sign-in, and expires
after 12 hours - about one shift. There are no refresh tokens.

The cookie is `httpOnly`, so page scripts cannot read it and an injected script
cannot steal the session. It is `SameSite=Strict`, which is what protects
against cross-site request forgery: the browser never attaches it to a request
started from another site. That works because the app and the API share one
origin - Caddy in production, the Vite proxy locally. `Secure` is set when
`NODE_ENV=production`.

On every request the API re-reads the user row and refuses the token if the
user is gone, inactive, or their `session_version` has moved on. That one
indexed lookup is what makes these take effect at once rather than when the
token expires:

| Event | Effect |
|---|---|
| Deactivated | Signed out everywhere on the next request; `session_version` bumped |
| Password reset by a superadmin | Signed out everywhere; `session_version` bumped |
| Own password changed | Other devices signed out; this browser gets a fresh cookie |
| Signed out | Every session of that person ends, on every device - `session_version` bumped - so a copied cookie stops working too |
| Anything that bumps `session_version` | The browser stops counting as able to take a call (`ringable_until` cleared - `AUTO-CALL-TRANSFER.md`, "Who is free"), so a signed-out or deactivated person is never rung for a transfer |
| Signed in, or signed out | The "Taking calls" switch goes off, recorded as `calls.availability_changed` when it was on - each sign-in the person chooses again whether to be rung for a transfer. The reason it is off (`taking_calls_why`) is written every time, so a missed transfer from an earlier session is not shown after signing in |
| Role changed | Applies on the next request. No bump is needed, since the row is re-read |

### On the frontend

- On load the app asks `/api/auth/me` and routes from the answer.
- Signed out: everything but `/login` sends the browser to `/login`.
- On a temporary password: everything but `/change-password` sends it there.
- Admin routes send agents to `/`. The API enforces the same rule on its own;
  the redirect only spares agents a page that would fail.
- A 401 in the middle of use - deactivated, reset, expired - drops the app to
  `/login` with "Your session ended. Sign in again to continue."
- A temporary password is shown once, in a panel that Escape and a click on
  the backdrop do not close, because closing it loses the password for good.

### Admin > Agents

`pages/admin/AgentsPage.tsx` is one card in the other admin pages' style, with
the grey header band: the email under the name, a "You" mark on your own row,
the role and the status each an icon and words - Superadmin a shield, Agent a
person; Active a tick, Pending first sign-in a clock in amber, Inactive a barred
circle, muted (`FRONTEND-STYLE.md`, "Status icons"). While it loads it draws
skeleton rows, the one list that does.

**A row's actions are behind one "⋯" menu** (`components/RowMenu.tsx`): Make
superadmin or Make agent, Reset password, and Deactivate in red - or
Reactivate. Each but Reactivate asks first in a confirm dialog. **Your own row
has no menu**: you cannot change your own role or deactivate yourself, and your
password is changed from the user menu. A failed Reactivate says so on its own
line - "Could not reactivate <name>." - not as a failed load of the list.

**Add agent** is a drawer from the right (`AddAgentDrawer.tsx`) - name, email,
and the role on the shared segmented switcher - which then shows the temporary
password once (`components/OneTimeSecret.tsx`). The page loads once and does
not poll; each change replaces its row with the server's answer.

## Rules

1. **Every failed sign-in looks the same.** An unknown email, a wrong password
   and an inactive account all return `invalid_credentials` with the same
   message, and the unknown-email and inactive paths run a dummy bcrypt
   comparison, so they take as long as a wrong password. Neither the answer nor
   its timing says whether an email is registered.
2. **Ten failed sign-ins per IP in 15 minutes, then 429.** Successful sign-ins
   are not counted, so a team sharing an office IP is not slowed down by normal
   use. Behind Caddy the IP comes from `X-Forwarded-For`, which is why the app
   trusts one proxy hop. The count is held in memory and starts again when the
   API restarts, which is acceptable for one API process.
3. **Passwords are bcrypt, cost 12, at least 10 characters and at most 72
   bytes.** bcrypt ignores everything past 72 bytes, so a longer password would
   be accepted and then only partly checked. A temporary password is 14
   characters from an alphabet with no look-alikes (no 0/O, 1/l/I), since it
   is read off a screen and typed by hand. Emails are stored lower-cased, so
   signing in ignores case.
4. **No self-lockout.** A superadmin cannot deactivate or demote themselves,
   nor reset their own password - they use Change password. Since only
   superadmins reach those routes, this alone keeps at least one active
   superadmin.
5. **Production refuses a weak `JWT_SECRET`.** With `NODE_ENV=production` the
   API will not start if the secret is one of the placeholders in this repo or
   shorter than 32 characters, since anyone who has read the repo could forge
   a token signed with one. Generate one with `openssl rand -hex 32`. The API's
   other start-up refusals - no webhook token, Twilio settings only partly set,
   a broken knowledge file of Seri's - are listed under `api.refused_start` in
   `LOGGING.md`.

## Data

The `users` table - its columns are in `SCHEMA.md`. Auth reads and writes
`password_hash`, `role`, `is_active`, `must_change_password`,
`session_version` and `last_login_at`, and on sign-in and sign-out the
"Taking calls" columns (`taking_calls`, `taking_calls_at`,
`taking_calls_why`); a bumped session clears `ringable_until`.

Every sign-in and account change is a row in the activity log (`AUDIT.md`):
`auth.signed_in`, `auth.signed_out`, `auth.password_changed`,
`auth.sign_in_failed` (the email tried and why - never the password),
`user.created`, `user.updated` with each changed field's old and new value,
and `user.password_reset`. No screen shows them; they are read in the
database.

## Code

| File | What it does |
|---|---|
| `backend/src/api/auth/routes.ts` | Sign-in, sign-out, `/me`, change password; the rate limit |
| `backend/src/api/auth/session.ts` | The cookie and the token: `signSession`, `verifySession`, `SESSION_TTL_SECONDS` |
| `backend/src/api/auth/middleware.ts` | `requireAuth`, `requirePasswordChanged`, `requireRole` - the row re-read on every request |
| `backend/src/api/auth/password.ts` | bcrypt, the password limits, `burnPasswordCheck`, `generateTemporaryPassword` |
| `backend/src/api/users/routes.ts` | Superadmin account management |
| `backend/src/api/users/rules.ts` | Input checks, `normalizeEmail`, `assertNotSelfLockout` |
| `backend/src/db/users.ts` | `pgUserStore`, the users table's SQL |
| `backend/src/api/startup-checks.ts` | `startupProblems`: the weak-secret refusal and the others |
| `backend/src/cli/create-superadmin.ts` | The first account |
| `frontend/src/auth/store.ts`, `frontend/src/auth/guards.tsx` | The session store and the route guards |
| `frontend/src/components/OneTimeSecret.tsx` | A temporary password, shown once |

## Tests

| What | Where |
|---|---|
| Every row of the session table but `ringable_until`; the rate limit, validation and access control - the real Express app against an in-memory user store, no database | `backend/src/api/__tests__/auth.test.ts`, `backend/src/api/__tests__/users.test.ts`, `npm test` |
| Sign-ins, refused sign-ins and account changes in the activity log, never a password | `backend/src/api/__tests__/activity.test.ts` |
| `ringable_until` cleared by a bumped session - SQL in `db/users.ts` | `backend/scripts/presence-live-check.ts` |
| The Postgres store itself | the live checks that create accounts (`presence-live-check.ts`, `hold-offers-live-check.ts`) and `backend/scripts/end-to-end.ts` |
| The start-up refusals | `backend/src/api/startup-checks.test.ts` |

## Not done

- The Agents table has no search or paging. Fine at about ten accounts.
- Sessions are not listed, nor revocable one at a time. The choices are to sign
  out everywhere - signing out or changing the password both do - or to
  deactivate.

## Decisions

| Decision | By | Date |
|---|---|---|
| No signup and no forgot-password: superadmins create accounts and reset passwords. Why not Cognito is in `ARCHITECTURE.md` | Jeel | 2026-09-14 |
| The session in an `httpOnly`, `SameSite=Strict` cookie, not localStorage | Jeel | 2026-09-14 |
| `/api/auth/me` answers 200 with `null`, not 401, when signed out | Jeel | 2026-09-14 |
| The same answer, in the same time, for every failed sign-in | Jeel | 2026-09-14 |
| 10 failed sign-ins per IP per 15 minutes; successes not counted; the count in memory | Jeel | 2026-09-14 |
| Production refuses a placeholder or short `JWT_SECRET` | Jeel | 2026-09-14 |

## History

- 2026-11-27 · Rewritten to the area template: the decisions in a table, the
  first-account steps to `RUNNING.md` and `DEPLOY.md`, the tests' list
  corrected - the Postgres store runs in the live checks and the e2e, not only
  locally; Admin > Agents on screen moved here from `FRONTEND.md` and
  `DESIGN-PROMPT.md` 6d · `docs/DOCS.md` · D13, D27, D30
- 2026-11-22 · A failed Reactivate showed "Could not load agents" with a Retry
  that loaded them; it now says what failed · review M33
- 2026-10-20 · Each write of "Taking calls" keeps why it is off
  (`taking_calls_why`), so a missed transfer is not shown after the next
  sign-in · T15c
- 2026-10-18 · A bumped session clears `ringable_until`; signing in and
  signing out switch "Taking calls" off · automated calls ring only people
  who chose to be rung · T9, T10
- 2026-10-01 · Every sign-in and account change written to the activity log,
  migration 006 · nothing may be lost (`AUDIT.md`)
- 2026-09-28 · Admin > Agents laid out like the other admin pages, and three
  text buttons on every row ("Make superadmin", "Reset password",
  "Deactivate") - most of what made the table busy - behind one "⋯" menu, the
  row menu's panel `position: fixed` so the last row's menu is not clipped;
  checked in the browser, Reset password opening its dialog from the menu ·
  Jeel
- 2026-09-14 · Sign-in, sessions, roles and account management built, ahead
  of the webhook, at Jeel's request · Phase 1
