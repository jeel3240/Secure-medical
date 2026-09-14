# Auth

Email and password sign-in for agents and superadmins. No self-signup, no
forgot-password: a superadmin creates accounts and resets passwords.

Code: `backend/src/api/auth/`, `backend/src/api/users/`, `backend/src/db/users.ts`,
`backend/src/cli/create-superadmin.ts`. Frontend: `frontend/src/auth/`,
`frontend/src/pages/LoginPage.tsx`, `ChangePasswordPage.tsx`, `pages/admin/`.

## First superadmin

Nobody can sign in to create an account until one exists, so the first
superadmin is created from the terminal:

```bash
docker compose exec api npm run dev:create-superadmin -- you@example.com "Your Name"
```

On the server, where the API runs compiled code, use `npm run create-superadmin`
instead. It prints a temporary password once. Sign in with it at
http://localhost:5173 and you are made to set your own password before anything
else works.

## Endpoints

All under `/api`, which is the only prefix Caddy forwards to the API.

| Method | Path | Who | Does |
|---|---|---|---|
| POST | `/api/auth/login` | anyone | Checks email + password, sets the session cookie. |
| POST | `/api/auth/logout` | anyone | Ends the session server-side and clears the cookie. |
| GET | `/api/auth/me` | anyone | The signed-in user, or `{ "user": null }`. |
| POST | `/api/auth/change-password` | signed in | Needs the current password. Signs out other devices. |
| GET | `/api/users` | superadmin | List accounts. |
| POST | `/api/users` | superadmin | Create an account; returns a temporary password once. |
| PATCH | `/api/users/:id` | superadmin | Change `name`, `role` or `isActive`. |
| POST | `/api/users/:id/reset-password` | superadmin | New temporary password, returned once. |

Errors are `{ "error": "<code>", "message": "<text>" }`. The frontend switches
on `error` and shows `message` as-is.

## How a session works

Sign-in returns a JWT in a cookie named `sm_session`. The token holds the user
id and the user's `session_version` at the time of sign-in, and expires after
12 hours, roughly one shift. There are no refresh tokens.

On every request the API re-reads the user row and rejects the token if the user
is gone, inactive, or its `session_version` has moved on. That one indexed
lookup is what makes these take effect immediately rather than when the token
expires:

| Event | Effect |
|---|---|
| Deactivated | Signed out everywhere on the next request. `session_version` bumped. |
| Password reset by an admin | Signed out everywhere. `session_version` bumped. |
| Own password changed | Other devices signed out; this browser gets a fresh cookie. |
| Signed out | That token dies server-side too, so a copied cookie stops working. |
| Role changed | Applies on the next request. No bump needed, since the row is re-read. |

## Decisions and why

**Cookie, not localStorage.** The cookie is `httpOnly`, so page scripts cannot
read it and an injected script cannot steal the session. It is
`SameSite=Strict`, which is what protects against cross-site request forgery:
the browser never attaches it to a request started from another site. That works
because the app and the API share one origin - Caddy in production, the Vite
proxy locally. `Secure` is set when `NODE_ENV=production`.

**`/api/auth/me` returns 200 with `null` when signed out.** Every page load asks
it before anyone has signed in, so "nobody" is the normal answer there. A 401
would log a red network error in the browser console on every visit to the
sign-in page.

**Same error for every failed sign-in.** Unknown email, wrong password and an
inactive account all return `invalid_credentials` with the same message, and
the unknown-email path runs a dummy bcrypt comparison so it takes as long as a
wrong password. Neither the response nor its timing confirms an email is
registered.

**Rate limit.** 10 failed sign-ins per IP per 15 minutes, then 429. Successful
sign-ins are not counted, so a team sharing an office IP is not slowed down by
normal use. The limit is in memory: it resets when the API restarts, which is
acceptable for one API process.

**Passwords.** bcrypt, cost 12. At least 10 characters and at most 72 bytes -
bcrypt ignores everything past 72 bytes, so a longer password would be accepted
and then only partly checked. Temporary passwords are 14 characters from an
alphabet without look-alikes (no 0/O, 1/l/I), since they are read off a screen
and typed by hand.

**No self-lockout.** A superadmin cannot deactivate or demote themselves, or
reset their own password (they use Change password). Because only superadmins
can reach those routes, this alone guarantees at least one active superadmin
always remains.

**Production refuses a weak `JWT_SECRET`.** With `NODE_ENV=production` the API
will not start if the secret is one of the placeholders in this repo or shorter
than 32 characters, since anyone who has read the repo could forge a token
signed with one. Generate one with `openssl rand -hex 32`.

## Frontend

- On load the app asks `/api/auth/me` and routes from the answer.
- Signed out: everything except `/login` redirects to `/login`.
- Temporary password: everything except `/change-password` redirects there.
- Admin routes redirect agents to `/`. The API enforces the same rule
  independently; the redirect is only so agents never see a page that would fail.
- If any request gets a 401 mid-use (deactivated, reset, expired), the app drops
  to `/login` with "Your session ended."

Temporary passwords are shown once, in a panel that Escape and backdrop clicks
do not dismiss, because closing it loses the password for good.

## Tests

```bash
cd backend && npm test
```

The HTTP tests run the real Express app against an in-memory user store, so
they need no database. They cover every row in the session table above,
rate limiting, validation, and access control. The Postgres store itself is
exercised by running the app locally.

## Not done yet

- The admin Agents table has no search or pagination. Fine at ~10 accounts.
- No audit trail of who created, reset or deactivated whom.
- Sessions are not listed or individually revocable; the options are sign out
  everywhere (password change) or deactivate.
