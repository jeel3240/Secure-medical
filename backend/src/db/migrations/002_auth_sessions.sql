-- Auth support for the users table.
--
-- last_login_at: shown in the admin Agents table (DESIGN-PROMPT.md 6d).
--
-- session_version: copied into every session token at sign-in. The API rejects
-- a token whose version no longer matches the row, so bumping it ends every
-- existing session for that user at once. Bumped on password change, admin
-- password reset, deactivation and logout. Without it a JWT stays valid until
-- it expires, which would let a deactivated agent or a reset password keep
-- working for up to 12 hours.
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
