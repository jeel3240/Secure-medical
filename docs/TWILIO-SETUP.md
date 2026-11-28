# Setting up Twilio calling

Use this when calling is set up on a server or a laptop: what the Twilio
account needs, the settings that switch calling on, pointing Twilio at the
server with `twilio:configure`, testing real calls on the dev number, and
deploying calling. How a call works once it is set up is `TWILIO.md` and
`INCOMING-CALLS.md`.

## Before you start

- **Check `TWILIO_PHONE_NUMBER` before running `twilio:configure` or
  `dev:twilio:configure` anywhere but the server.** Production is live on
  **(480) 470-8259** and the TwiML App `secure-medical-calling`. If a laptop's
  `.env` holds that number or that app, stop and say so: never run the command
  there. The command points both at whatever `PUBLIC_URL` says, so run from a
  laptop it moves them to that laptop's tunnel: leads who call the number ring
  nobody in production, and calls agents place fail, until it is run on the
  server again. Nothing errors while that happens. The command's own refusal
  ("Pointing Twilio at the server") is a second line, not a reason to try.
- **Local work uses the dev number, (480) 530-8582**, with its own TwiML App,
  `secure-medical-calling-dev`, and `TWILIO_IDENTITY_PREFIX=dev-` - never
  production's.
- **Every variable** - its name, what it is and where it is set - is in
  `ENVIRONMENT.md`; `.env.example` says where each comes from in the Twilio
  Console.
- **Every call on the account is a real call.** Test to your own phone, with a
  lead whose phone is your own.

## What it needs on the Twilio account

| What | Why |
|---|---|
| A voice-capable phone number, on the same account | The caller ID leads see (`TWILIO_PHONE_NUMBER`, E.164); its Voice URL is `PUBLIC_URL/api/webhooks/twilio/incoming`, for a lead calling in, with no TwiML App on the number - an app on the number wins over its Voice URL |
| A TwiML App | Its Voice URL is `PUBLIC_URL/api/webhooks/twilio/voice`: Twilio asks it how to connect each call a browser starts |
| A **Standard** API key and its secret | They sign the browser's token. The secret is shown once |
| The account SID and auth token | The token checks that webhooks are Twilio's (`TWILIO.md`, "Why the webhooks can be trusted") and lets `twilio:configure` change the account |
| A transcription service - optional | Every call is recorded and transcribed while it is set (`TWILIO.md`, "Recordings and transcripts"). `npm run twilio:configure -- --transcription` makes it once - US English, `secure-medical-call-transcripts`, found again by that name rather than made twice - and prints its id for `.env`. Twilio's "data logging", using our calls to train its models, is left off; it cannot be switched on through the API anyway |
| ConversationRelay's onboarding, completed in the Twilio Console - it includes accepting Twilio's AI features addendum, which only the account owner can do | Seri's calls connect through `<Connect><ConversationRelay>` (`AI-RELAY.md`, "The TwiML"); until the onboarding is done, every such call fails |

**One number rings one deployment**, and so does one TwiML App: each points at
one address.

**A different number is not enough; the browser's name must differ too.**
Twilio rings a browser by the name in its token - `agent-21` for user 21 - and
rings *every* browser on the account with that name, whichever number the call
came in on. A laptop on the same Twilio account would name its user 21
`agent-21` as well, so production's calls would ring the laptop, and the
laptop's test calls a real agent. `TWILIO_IDENTITY_PREFIX` puts a prefix in
front of every name (`identityFor`, `backend/src/core/calls.ts`): empty in
production, so its names are `agent-21`; `dev-` locally, so the laptop's user
21 is `dev-agent-21`. Each server reads only its own names back - production
does not take `dev-agent-21` for user 21, nor a laptop `agent-21`.

**Local calling uses its own number, TwiML App and prefix.** The dev number
(480) 530-8582 was added to the account by the client for development, and the
TwiML App `secure-medical-calling-dev` made for it. The local `.env` holds
`TWILIO_PHONE_NUMBER=+14805308582`, that app's id as `TWILIO_TWIML_APP_SID`,
and `TWILIO_IDENTITY_PREFIX=dev-`; the account SID, auth token and API key are
shared with production. A local `.env` never holds production's number or
TwiML App. `PUBLIC_URL` stays empty - so calling is off on the laptop - until a
tunnel is set up for a test ("Testing locally, on the dev number").

## Settings

Seven variables switch calling on - the six `TWILIO_*` account settings and
`PUBLIC_URL` - all or none. Two more are optional and apart from the seven:
`TWILIO_TRANSCRIPTION_SERVICE_SID` and `TWILIO_IDENTITY_PREFIX` (lower-case
letters and digits ending in a hyphen). Each variable: `ENVIRONMENT.md`.

`backend/src/twilio-settings.ts` (`readTwilioSettings`) reads them into one of
three states, and checks the shape of each value - a typo here is a call that
fails later, with a worse error:

| State | When | Effect |
|---|---|---|
| **off** | None of the six `TWILIO_*` account variables is set - `PUBLIC_URL` and the two optional ones alone do not count | The app runs as before. The Call button is off: "Calling is not set up on this server." Every Twilio webhook answers 404 |
| **on** | All seven are set and well-formed, and the optional ones are empty or well-formed | Calling works |
| **incomplete** | Some are set, or one is malformed - an optional one included: a malformed prefix is refused rather than used or dropped | Locally: calling is off and the API logs `calling.off` naming what is missing. **In production the API refuses to start** (`twilio_incomplete`, `backend/src/api/startup-checks.ts`), because a half-set configuration looks fine and fails every call |

The api and the worker both read them - the worker fetches transcripts - so a
change is picked up by recreating both (`docker compose up -d`).

## Pointing Twilio at the server

`twilio:configure` (`backend/src/cli/twilio-configure.ts`) sets the TwiML App's
Voice URL to `PUBLIC_URL/api/webhooks/twilio/voice` and the phone number's to
`PUBLIC_URL/api/webhooks/twilio/incoming`, and changes nothing else on the
account. It reads only the Twilio variables, so it runs without a database.
Run it once `PUBLIC_URL` is set, again whenever `PUBLIC_URL` changes, and last
at a deploy that changes a Twilio setting.

1. Check `TWILIO_PHONE_NUMBER` ("Before you start").
2. See what it would change, changing nothing:

   ```bash
   # on the server
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run twilio:configure -- --dry-run
   # locally, with the dev number in .env
   docker compose exec api npm run dev:twilio:configure -- --dry-run
   ```

3. Run it without `--dry-run`. Each line says what was pointed, what it was
   and what it is now, or that it already pointed here.

The two are the same command - `dev:` runs it with `ts-node`, the other from
`dist/`. **Neither checks which number it is given:** it points whatever
`TWILIO_PHONE_NUMBER` and `TWILIO_TWIML_APP_SID` hold, so locally it is the dev
number only because the local `.env` holds the dev number. What stops a laptop
taking production's calls is the pointing check, `decidePointing` in
`backend/src/core/twilio-pointing.ts`, for the number and the TwiML App alike:

| Points now at | Without `--take-over` |
|---|---|
| This address already | Nothing to change |
| Nowhere | Pointed |
| This app on the same server - a different method, say | Pointed |
| This app on a quick tunnel (`trycloudflare.com`, `ngrok`) - an earlier laptop session, or production's own calls after an accident, being brought back by running it on the server | Pointed |
| This app on another real server - production, run from a laptop | **Refused**: "points at this app on another server" |
| An address that is not this app - somebody's working phone line | **Refused** |
| A number answered by another TwiML App | **Refused** |

Both are decided before either is changed, so a refusal leaves them as they
were - "Nothing was changed." - never half-moved. `--take-over` overrides a
refusal; use it only when moving that line here is really meant.

`--transcription` also makes the transcription service if there is none yet
("What it needs on the Twilio account").

## Testing locally, on the dev number

Locally a real call needs a public address, because Twilio must reach the
webhooks - and the dev number, its TwiML App and the `dev-` prefix in the local
`.env`, never production's.

1. Check the local `.env` holds only the dev number (480) 530-8582, the
   `secure-medical-calling-dev` TwiML App and `TWILIO_IDENTITY_PREFIX=dev-`.
2. Start a tunnel; it prints an https address:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

3. Put that address in `.env` as `PUBLIC_URL`.
4. Start the api: `docker compose up -d api`. Started alone, without the
   worker, nothing polls EZ Texting or asks the text questions - but the api
   still sends the missed-call text itself, through EZ Texting, when a call to
   the number goes unanswered, exactly as production would. Test with a lead
   whose phone is your own.
5. `docker compose exec api npm run dev:twilio:configure -- --dry-run`, then
   without `--dry-run` ("Pointing Twilio at the server").
6. Place a call from a lead that is your own phone; call (480) 530-8582 from
   it: only the local browser rings, as `dev-agent-<id>`.

A quick tunnel's address changes every time it starts, so repeat steps 3 to 5
each time. Nothing needs undoing after a session: when the tunnel stops, only
the dev number points at a dead address; the next session starts a tunnel and
runs `dev:twilio:configure` again. The robot's calls locally ring only
`AUTO_CALL_TEST_NUMBERS` (`AUTO-CALLS.md`).

## Deploying it

1. Set the seven variables in the server's `.env` (`ENVIRONMENT.md`):
   `PUBLIC_URL` is production's `https://` address; `TWILIO_IDENTITY_PREFIX`
   stays empty; `TWILIO_TRANSCRIPTION_SERVICE_SID` is the service already
   made.
2. Deploy as usual, including `npm run migrate` (`DEPLOY.md`). Calling's
   tables and columns come with the rest - incoming calls in migrations 007
   and 008, voicemail detection in 010, recordings and transcripts in 011.
3. Point Twilio at the server, last: `docker compose -f docker-compose.yml -f
   docker-compose.prod.yml exec api npm run twilio:configure` ("Pointing
   Twilio at the server"). Nobody runs it anywhere else with this number.
4. Sign in, pick up a lead that is your own phone, press Call: it rings,
   showing the number.
5. Call the number from that phone: the browser rings.
6. Admin > Overview's **Calling** check reads OK (`LOGGING.md`, "Health
   endpoint").

## When it goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Admin > Overview shows **Calling** as Degraded | The number or the TwiML App does not point at this server - `twilio:configure` run elsewhere, or a change made by hand in the Twilio Console. Twilio is asked at most once a minute, so it shows within a minute | Run `npm run twilio:configure` on the server; the check clears within a minute |
| Leads who call ring nobody, and agents' calls fail, with nothing in the logs | Production's number or TwiML App was moved to a laptop's tunnel | The same: `twilio:configure` on the server brings both back - an old tunnel is not a refusal |
| `twilio.webhook_rejected` in the logs, and calls that end at once | `PUBLIC_URL` is not exactly the address Twilio calls, so every signature fails | Set it to the address Twilio uses, with no trailing slash, recreate the api, run `twilio:configure` |
| The API will not start in production: `twilio_incomplete` | Some calling variables are set and some not, or one is malformed | Set all seven, well-formed, or none (`ENVIRONMENT.md`) |
| Locally, `calling.off` with the missing variables named | The same, on a laptop: calling stays off | As above |
| The Call button fails at once - "The call did not connect" - and nothing reaches the server, while the robot's calls still work | The tunnel restarted and the TwiML App still points at the old address; each robot call carries its own addresses, so it is only the button | Steps 3 to 5 of "Testing locally, on the dev number" |
| `twilio:configure` says "points at this app on another server" | It was about to take that server's calls - production's, most likely | Stop: check `TWILIO_PHONE_NUMBER`. `--take-over` only when that is really meant |
| `twilio:configure` says "is not a number on this Twilio account" | `TWILIO_PHONE_NUMBER` is wrong, or on another account | Check it against the Twilio Console |

## History

- 2026-11-27 · Written from `TWILIO.md`'s "What it needs on the Twilio account", "Settings", "Testing" and "Deploying it"; the variables linked to `ENVIRONMENT.md`; the production-number rule stated here once · how-to steps had sat in an area doc · D39
- 2026-11-27 · ConversationRelay's onboarding added to what the account needs · it sat only in `AI-AGENT.md` and the A02 ticket · D41, D43
- 2026-11-23 · Said plainly that `twilio:configure` does not check which number it is given, and that the pointing check is what stops a laptop · review R10
- 2026-11-12 · ConversationRelay's onboarding completed on the account, with the AI features addendum accepted by the account owner (asked 2026-11-11), before Seri's first test calls · A02
- 2026-10-22 · Seen: a tunnel restarted without `dev:twilio:configure` left the Call button failing at once - "The call did not connect" - while the robot's calls and their transfers still worked
- 2026-10-17 · Three real calls on the dev number, the first local calls since 2026-10-05, the api running alone and the test lead, with Jeel's phone, in the local database only: the local app called Jeel's phone - it rang showing (480) 530-8582, not picked up, saved `outbound`, `no_answer`; Jeel called (480) 530-8582 - only the local browser rang, as `dev-agent-16`, answered, `inbound`, 6 s, recording saved; he called again - not answered, `inbound`, `missed`, a missed-call callback for him, and the missed-call text sent to his phone. Production's number and TwiML App were read back on Twilio before and after: both still pointed at production. The day's notes first said a local session could not text anyone; that was wrong, found the next day · T3
- 2026-10-16 · `TWILIO_IDENTITY_PREFIX`: a laptop's browsers named `dev-agent-<id>` · a laptop on the same account named its browsers like production's, so production's calls would have rung it · T1
- 2026-10-16 · `twilio:configure` refuses what another server relies on, for the number and the TwiML App alike, both decided before either is changed; `--take-over`, `--dry-run` (`core/twilio-pointing.ts`) · until then it left alone only a number that rang another app; a laptop and production are the same app with the same webhook path, so it went straight through, and the TwiML App was changed without any check · T2
- 2026-10-15 · The dev number set up for local work: (480) 530-8582, added to the account by the client the day before, voice and SMS, pointing nowhere; the TwiML App `secure-medical-calling-dev` made; the local `.env` given them, with `PUBLIC_URL` empty, in place of production's · T3
- 2026-10-05 · Never run `twilio:configure` locally with production's number · production went live on (480) 470-8259 and `secure-medical-calling`. From then until 2026-10-16 calling was not tested locally at all: the local `.env` kept its `TWILIO_*` lines empty · Jeel
- 2026-10-02 · Up to here, before production took calls, local testing used (480) 470-8259 - the test notes of 2026-10-01 and 2026-10-02 in `TWILIO.md`'s History are from then
- 2026-10-01 · Calling set up: the seven settings, `twilio:configure` pointing the TwiML App and the number, a tunnel for local tests · Phase 4
