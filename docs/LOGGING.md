# Logging and health

Every line the api and the worker write is one JSON object, so whatever collects
the logs can query them by field instead of matching substrings: `info` on stdout,
`warn` and `error` on stderr. The logger is `backend/src/lib/log.ts`; on the server
the lines go to CloudWatch (`DEPLOY.md`). **Never log a phone number, a message
body, a name, a password, a token or the EZ Texting credentials** - logs leave the
machine and are kept for months, and a lead id is enough to find the row. It is the
one rule here that is not a preference, and the logger enforces it. This doc lists
every event, and the health endpoints.

## The line

```json
{"ts":"2026-09-23T10:04:11.204Z","level":"info","event":"poll.tick","svc":"worker",
 "fetched":2,"inserted":1,"skipped":1,"suppressed":0,"openers":1,"ms":336}
```

```ts
log.info('poll.tick', { fetched: 2, inserted: 1, ms: 336 });
log.error('sms.failed', { leadId, key, err: errText(err) });
```

| Field | What |
|---|---|
| `ts` | When, ISO 8601, UTC |
| `level` | `info`, `warn` or `error`. An alarm on `level=error` is the cheapest useful alarm there is, which is why `warn` and `error` go to stderr - what most collectors alert on |
| `event` | A dotted name from "Events in use" - the field everything is grouped by |
| `svc` | `api` or `worker`, worked out from the entry point; `SERVICE_NAME` wins when set (`ENVIRONMENT.md`). Not an env var by default: one that has to be set in every compose file is one that will be missing from one of them |
| anything else | The call site's. Identifiers go in their own fields - `leadId`, `callId`, `conversationId` - so one lead's history can be pulled out of a day's logs. Undefined values are dropped |
| `err` | `errText(err)`: an Axios `response.data` - where EZ Texting puts the reason - or else the message. Never the stack, which can carry a message body inside an interpolated string |

## Redaction

`redact()` runs on every line before it is written.

| What | How |
|---|---|
| A forbidden field name | `phone`, `fromNumber`, `toNumber`, `number`, `body`, `message`, `text`, `name`, `firstName`, `lastName`, `email`, `password`, `token`, `secret`, `authorization` and the EZ Texting credentials, in any case - and any name ending in `password`, `secret`, `token`, `key` or `phone` (`apiKey`, `accessToken`, `leadPhone`). Replaced with `[redacted]` rather than dropped: a field that vanishes is harder to debug than one plainly hidden. One level deep into plain objects |
| Allowed despite the suffix rule | `key` - which text an `sms.*` event is about, the field those events group by - and `eventKey`, `settingKey` |
| A number inside a text | Any E.164 number (`+16025550123`) in any string logged - an error's message above all - becomes `[redacted phone]`: a field's name cannot see into a sentence. Our own ids have no `+` and are kept |
| An `Error` | Reduced to its message, with numbers redacted |
| The EZ Texting webhook's path | `http.unhandled` logs it as `/api/webhooks/eztexting/:token`, never its secret token (`loggablePath`, `api/http.ts`) |

## Events in use

Every `log.info`, `log.warn` and `log.error` in `backend/src`. A line carries
`leadId`, `callId` or `callSid`, never a number; what was said or heard is in the
database, never here.

### The api and the worker starting

| Event | Level | When, and its fields | File |
|---|---|---|---|
| `api.started` | info | The api is listening: `port`, `calling` (`on`, `off` or `incomplete`), `autoCalls` (`on` or `off`), `knowledge` - the version of Seri's knowledge files | `api/index.ts` |
| `api.refused_start` | error | The api will not start: `reason` - `weak_jwt_secret`, `no_webhook_token` or `twilio_incomplete` (with `missing`, the settings not set) in production (`api/startup-checks.ts`); or, in any environment, `ai_knowledge_invalid`, one line per problem in Seri's knowledge files with the `problem`, its file and field (`ai/knowledge.ts`) | `api/index.ts` |
| `api.stopping` | info | Docker's SIGTERM, or SIGINT: `signal`, and `seriCalls` - the calls with Seri whose line is handed back to Twilio to reconnect (`AI-AGENT.md`, "When the line drops") | `api/index.ts` |
| `calling.off` | warn | At start, Twilio set up only partly outside production: `reason: incomplete_settings`, `missing` | `api/index.ts` |
| `auto_calls.off` | warn | At start: `AUTO_CALLS` said something other than `on` or `off` (`reason: unknown_value`, with the `value`), or `on` without calling set up (`reason: calling_off`) | `api/index.ts` |
| `worker.started` | info | `autoCalls`: whether this worker places automated calls | `worker/index.ts` |
| `auto_calls.test_numbers_invalid` | warn | Once at start: the `count` of `AUTO_CALL_TEST_NUMBERS` entries that are not E.164, left out | `worker/index.ts` |
| `auto_calls.switch_not_recorded` | error | The worker could not record whether it starts with automated calls on; it carries on | `worker/index.ts` |
| `worker.another_running` | warn | Another worker holds the cycle's lock, so this one skips - logged once until that changes | `worker/index.ts` |
| `worker.cycle_failed` | error | The lock could not be asked for - the database not answering; the next tick tries again | `worker/index.ts` |

### Polling, expiry and first questions

| Event | Level | When, and its fields | File |
|---|---|---|---|
| `poll.tick` | info | Each poll that read EZ Texting: `fetched`, `inserted` (new leads), `skipped`, `suppressed`, `openers` (first questions sent), `failed` (contacts the database refused), `ms` | `worker/index.ts` |
| `poll.contact_failed` | error | One contact could not be taken in; the rest of the poll goes on, and it is read again next poll (`POLLER.md`, "Why each piece is there"): `createdAt` - when EZ Texting listed it - and `err`. Never its phone or name | `worker/poller.ts` |
| `poll.failed` | error | A poll failed - EZ Texting could not be read, or listed a page oldest first: `err`; the checkpoint is left where it was | `worker/index.ts` |
| `conversation.expired` | info | Only when the sweep expired some: `expired`, `ms` | `worker/index.ts` |
| `expiry.failed` | error | The sweep failed, `err` | `worker/index.ts` |
| `opener.retry` | info | One line per pass that had something due: `due`, `sent`, `failed`, `unconfirmed` (timed out, perhaps delivered - taken as sent), `abandoned`, `tooOld`, `ms` (`POLLER.md`, "Retrying a failed opener") | `worker/index.ts` |
| `opener.retry_failed` | error | The retry pass failed, `err` | `worker/index.ts` |
| `opener.gave_up` | warn | Once, at the failed attempt that reaches the limit: that lead will never get its first question. `attempts` | `worker/retry-openers.ts` |

### Texts

Which text a line is about: the first question logs `key: question_1` - the
opener's name in the logs, though its words come from the lead's flow; a text sent
after a reply logs `flow`, the flow's key (`antibiotics`), since one text can carry
a reply and the next question; the text after a missed call logs
`key: message_missed_call`, and the link a lead said yes to on the automated call
`key: call_link_text` (`db/lead-texts.ts`).

| Event | Level | When, and its fields | File |
|---|---|---|---|
| `sms.sent` | info | A text went out: `eztMessageId`, with `key` or `flow`; `retry` on a retried first question | `worker/poller.ts`, `worker/retry-openers.ts`, `api/reply-flow.ts`, `db/lead-texts.ts` |
| `sms.failed` | error, warn | A text did not go out: `blocked` when refused for a blocked number, `err`; `agentSms: true` for an agent's own. **At `warn` for the missed-call text and the call's link**, a real refusal by EZ Texting included - an alarm on `level=error` alone does not catch them | `worker/poller.ts`, `worker/retry-openers.ts`, `api/reply-flow.ts`, `db/agent-sms.ts`, `db/lead-texts.ts` |
| `sms.unconfirmed` | warn | A send to EZ Texting timed out: it may or may not have gone. Not retried, and the only line for it - no `sms.failed` beside it, nor `opener.gave_up` on the last try | `db/outbound.ts` |
| `sms.no_template` | error | No words to send - no active flow question, or no missed-call or link text: `key` | `worker/poller.ts`, `db/lead-texts.ts` |
| `sms.name_dropped` | info | A first name too long for one segment, sent as "there" instead | `worker/opener.ts` |
| `sms.record_failed` | error | A send could not be written down: `sentAnyway: true` when it went out and only its EZ Texting id is missing | `db/outbound.ts`, `db/failed-sends.ts` |

### Replies from EZ Texting

| Event | Level | When, and its fields | File |
|---|---|---|---|
| `webhook.rejected` | warn | A request on a wrong path token: `reason: bad_token` | `api/webhooks.ts` |
| `webhook.ignored` | info, warn | Answered 200 and left, with `reason`: `wrong_type` (info), `missing_fields` and `bad_fields` - a field of the wrong kind (warn), and the ones `WEBHOOKS.md` lists - `no_lead`, `duplicate` | `api/webhooks.ts` |
| `webhook.failed` | error | The handler failed, `err`; EZ Texting will retry | `api/webhooks.ts` |
| `conversation.advanced` | info | Only when the reply produced a text to send: `status`, `step`, `score`, `tier`, `parts` (how many pieces the text had), `sent` | `api/webhooks.ts` |
| `conversation.expiry_not_moved` | error | A text went out but its reply window could not be saved | `api/reply-flow.ts` |
| `reply.before_our_text` | info | A reply arrived before the text it would answer had gone out, and was not counted; `forPerson: true` when that text has been unsent for over two minutes and the lead was flagged instead (`STATE-MACHINE.md` rule 2c) | `api/reply-flow.ts` |
| `dnc.blocked` | info | A STOP blocked a lead's number: `suppressed` | `api/webhooks.ts` |
| `dnc.released` | info | A START lifted a block; `hasLead: false` for a number we hold no lead for | `api/webhooks.ts` |

### Browser calling, incoming calls, Twilio

| Event | Level | When, and its fields | File |
|---|---|---|---|
| `call.token_issued` | info | A browser got its call token: `userId` | `api/calls.ts` |
| `call.started` | info | An agent's call was placed: `agentId`, `leadId`, `callSid` | `api/twilio-webhooks.ts` |
| `call.refused` | warn | An agent's call was not placed: `reason` (`TWILIO.md`) | `api/twilio-webhooks.ts` |
| `call.failed_to_start` | error | The database failed as a call started | `api/twilio-webhooks.ts` |
| `call.finished` | info | A call's end was saved: `outcome`, `durationSec`, `recorded`, `missed` | `api/twilio-webhooks.ts` |
| `call.answered_by` | info | Twilio's verdict on who picked up: `answeredBy`, `recorded` | `api/twilio-webhooks.ts` |
| `call.recorded` | info | A recording is ready: `recordingSid`, `durationSec`, `saved` | `api/twilio-webhooks.ts` |
| `call.incoming` | info | A lead rang us: `leadId` and the `agentId` rung; or `ring: 'group'` and `rung`, how many, when everyone free rang for a lead nobody owns; or `missed: true` and `known` when nobody could be rung | `api/twilio-webhooks.ts` |
| `call.incoming_failed` | error | The database failed on an incoming call | `api/twilio-webhooks.ts` |
| `call.missed_not_recorded` | error | A missed call's end could not be saved | `api/twilio-webhooks.ts` |
| `call.ring_not_taken` | warn | A ring to everyone free that Twilio said `completed` but nobody took - its only accept refused: a missed call. `dialStatus` | `api/twilio-webhooks.ts` |
| `call.taken` | info | Someone accepted a call that rang everyone free: `agentId`, `leadId`, `tookOverFrom` when the lead was someone else's | `api/twilio-webhooks.ts` |
| `call.take_refused` | warn | A second accept, or an account deactivated: `reason` - `taken`, `inactive`, `not_found` | `api/twilio-webhooks.ts` |
| `call.unknown_take` | warn | An accept naming no lead's call, or another server's browser: `parentSid`, and `toBrowser` - whether Twilio's `To` was a browser name at all, never its value, which can be a phone number | `api/twilio-webhooks.ts` |
| `call.take_failed` | error | The database failed as someone accepted; they are connected anyway | `api/twilio-webhooks.ts` |
| `call.end_not_recorded` | error | A ring taken whose end could not be saved | `api/twilio-webhooks.ts` |
| `call.closed_late` | warn | A call whose end never came, ended from Twilio's record 15 minutes or more after it started (`TWILIO.md`, "Calls whose end never came") | `api/left-open.ts` |
| `call.close_late_failed` | error | One that could not be ended so: `callId`, `err` | `api/left-open.ts` |
| `call.left_open_watch_failed` | error | The whole look for such calls failed | `api/left-open.ts` |
| `twilio.webhook_rejected` | warn | A request whose signature failed: `reason: bad_signature`, `path`. Usually `PUBLIC_URL` is not the address Twilio calls | `api/twilio-webhooks.ts` |
| `twilio.archive_failed` | error | A webhook could not be archived (`AUDIT.md`); the call goes on | `api/twilio-webhooks.ts` |
| `twilio.request_failed` | warn | A request to Twilio about a live call failed: `what` (`transfer_rings`, `recheck_hold`, `send_to_offer`, `replace_call`, `call_end`), and Twilio's `status` and `code` - never its message, which can quote a number | `integrations/twilio-calls.ts` |

### Automated calls

The robot's calls are `AUTO-CALLS.md`'s; its script and voicemail `AUTO-CALL-SCRIPT.md`'s; the transfer and the hold line `AUTO-CALL-TRANSFER.md`'s.

| Event | Level | When, and its fields | File |
|---|---|---|---|
| `auto_call.placed` | info | Twilio took the call: `leadId`, `callId`, `callSid` | `worker/place-auto-call.ts` |
| `auto_call.refused` | warn | Not placed: `reason` | `worker/place-auto-call.ts` |
| `auto_call.failed` | error | Twilio refused the lead's number - their call, used: `twilioStatus`, `twilioCode` | `worker/place-auto-call.ts` |
| `auto_call.not_placed` | error | Twilio refused for any other reason - our account, a limit - and the lead's call was not used (`AUTO-CALLS.md`, "When Twilio refuses"): `twilioStatus`, `twilioCode` | `worker/place-auto-call.ts` |
| `auto_call.unconfirmed` | warn | Twilio did not answer - the call may have gone out: `error` | `worker/place-auto-call.ts` |
| `auto_call.link_failed` | error | The call went out but could not be linked to its row | `worker/place-auto-call.ts` |
| `auto_call.dial` | info | One look of the worker placing calls, logged only when something happened - calls closed that never reached Twilio (`closed`), leads due (`due`), or another worker dialling (`locked`): `inside` (the calling hours), `room`, `stopped` (`on_hold`, `silent`, `refused`, `no_script`, `openai_down`, `ai_fallbacks`, or null), `aiError` (OpenAI's status and code when it was down), `silent`, `skipped` (no longer due when their turn came), and how each call went - `placed`, `refused`, `failed`, `notPlaced`, `unconfirmed`; a `notPlaced` or `unconfirmed` ends the look | `worker/index.ts` |
| `auto_call.dial_failed` | error | A look failed; the next tick tries again | `worker/index.ts` |
| `auto_call.webhooks_silent` | error | Twilio's reports are not reaching us, so nothing is placed: `calls`, how many unheard of. Once when it starts | `worker/index.ts` |
| `auto_call.twilio_refusing` | error | Twilio refused a call for our account's reasons, or never confirmed one, in the last 15 minutes, so nothing is placed until then. Once when it starts | `worker/index.ts` |
| `auto_call.no_script` | error | No call script active - from the worker once when it starts, or from a webhook | `worker/index.ts`, `api/twilio-webhooks.ts` |
| `auto_call.dialling_again` | info | Placing calls again: `after`, what had stopped it | `worker/index.ts` |
| `auto_call.answered` | info | The call was answered: `to` - `seri` when connected to Seri, `script` when the script's first question was asked | `api/twilio-webhooks.ts` |
| `auto_call.unknown_call` | warn | A webhook naming no row of ours, or another call's - or, accepting a transfer, no browser of ours: `path`, `callId` | `api/twilio-webhooks.ts` |
| `auto_call.broken_script` | error | The script led nowhere it could go | `api/twilio-webhooks.ts` |
| `auto_call.answer_failed`, `auto_call.gather_failed` | error | `/auto/answer` or `/auto/gather` failed | `api/twilio-webhooks.ts` |
| `auto_call.answer` | info | One per answer: `step`, `attempt`, `meaning` (the choice's label, or `silence`, `unclear`, `opt_out`), `confidence`, `hungUp`, `result`, `kept` (false for a repeated request). Never what was heard - that is in `call_answers` | `api/twilio-webhooks.ts` |
| `auto_call.transfer` | info | People rung for a "yes": `rung`, how many, and `holderFirst` - the lead's own agent, alone | `api/twilio-webhooks.ts` |
| `auto_call.holder_not_taken` | info | That agent let it ring out or declined (`agentId`, `dialStatus`); the others are rung next | `api/twilio-webhooks.ts` |
| `auto_call.transfer_missed` | info | Nobody took it: `reason` - `nobody_free`, `not_taken` or `hung_up` (the lead hung up while it rang), the last two with `dialStatus` | `api/twilio-webhooks.ts` |
| `auto_call.ring_not_taken` | warn | A transfer ring Twilio said `completed` that nobody took - its only accept refused; it ends as one nobody took. `dialStatus` | `api/twilio-webhooks.ts` |
| `auto_call.transferred` | info | Who took it: `agentId`, `leadId`, `tookOverFrom` | `api/twilio-webhooks.ts` |
| `auto_call.transfer_refused` | warn | A person's accept refused: `reason` - `taken`, `inactive`, `not_found` | `api/twilio-webhooks.ts` |
| `auto_call.claim_failed`, `auto_call.after_failed` | error | The database failed as a person accepted (they are connected anyway), or as the ringing ended | `api/twilio-webhooks.ts` |
| `auto_call.ring_missed` | info | A person let it ring out: `agentId`, and `switchedOff` - false when the switch was already off, or they were on a call by then | `api/twilio-webhooks.ts` |
| `auto_call.rings_unread` | warn | Twilio could not be asked how each ring ended, so nobody was switched off | `api/twilio-webhooks.ts` |
| `auto_call.switch_off_failed` | error | Switching someone off failed | `api/twilio-webhooks.ts` |
| `auto_call.hold` | info | A "yes" put on hold | `api/twilio-webhooks.ts` |
| `auto_call.hold_ended` | info | The lead leaves hold for the busy line: `reason` (`nobody_coming`, `waited_too_long`, `not_on_hold`), `waitedSeconds`, `via` - `watcher` when the hold watcher cut the music, `music` when a track ended | `api/twilio-webhooks.ts` |
| `auto_call.hold_failed` | error | `/auto/hold` failed | `api/twilio-webhooks.ts` |
| `auto_call.hold_recheck` | info | The hold watcher sending a lead back: `reason` (`nobody_coming`, `waited_too_long`), `sent` - whether Twilio took it | `api/hold-watch.ts` |
| `auto_call.hold_closed` | warn | The watcher ended a held call whose end report never came, from Twilio's record | `api/hold-watch.ts` |
| `auto_call.hold_watch_failed` | error | A look of the hold watcher failed | `api/hold-watch.ts` |
| `auto_call.offer` | info | A lead on hold offered to someone who came free: `offerId`, `agentId`, `sent` - false when Twilio would not take the redirect | `api/hold-watch.ts` |
| `auto_call.offer_ringing` | info | The call reached `/auto/offer` and rings that person | `api/twilio-webhooks.ts` |
| `auto_call.offer_not_taken` | info | `outcome` (`declined`, `missed`, `failed`, `hung_up`) and Twilio's `dialStatus` | `api/twilio-webhooks.ts` |
| `auto_call.offer_failed` | error | From `/auto/offer` with `callId`; or, with `userId`, offering to someone who had just come free failed - their browser's answer is not affected | `api/twilio-webhooks.ts`, `api/calls.ts` |
| `auto_call.verdict` | info | Twilio's verdict on a live call acted on: `verdict` (`beep`, `machine`, `fax`), `action` (`voicemail`, `hang_up`, `carry_on`), `tookOver` - false on `carry_on`, or when Twilio refused the takeover | `api/twilio-webhooks.ts` |
| `auto_call.verdict_failed` | error | After Twilio had its answer | `api/twilio-webhooks.ts` |
| `auto_call.after_takeover` | info | A request about a call the voicemail message had taken over, ignored - not taken as an answer or a transfer: `path`, `dialStatus` for a ring's end. From `/auto/ai-after` too | `api/twilio-webhooks.ts` |
| `auto_call.ai_after` | info | The end of Seri's part (`AI-AGENT.md`): Twilio's `status` (`ended`, `failed`, `completed`), the `action` carried out (null: she ended with none), `hungUp`, Twilio's `errorCode` on a failure, `why` for a fallback; then the transfer's own lines, as on the script | `api/twilio-webhooks.ts` |
| `auto_call.ai_after_failed` | error | The call ends quietly | `api/twilio-webhooks.ts` |
| `auto_call.callback_booked` | info | A call back Seri booked was saved, once: `callbackId` | `api/twilio-webhooks.ts` |
| `auto_call.callback_time_refused` | error | Its time fell outside the agents' hours on the second check - `why`: `past`, `too_soon`, `too_far`, `outside_hours`. A bug, since the relay checked it first; booked all the same | `api/twilio-webhooks.ts` |

### Seri

Seri's relay is the WebSocket Twilio opens when a call goes to her; her brain
understands, decides and speaks (`AI-AGENT.md`). Never a word said: those are in
`call_ai_turns`. After `ai_relay.started`, lines carry `callId` only.

| Event | Level | When, and its fields | File |
|---|---|---|---|
| `ai_agent.no_key` | warn | Once per process: her switch says on but `OPENAI_API_KEY` is not set, so calls get the script. Never the key | `ai/settings.ts` |
| `ai_agent.switched` | info | Her switch changed from Admin > Configuration: `to`, `changed`, `via: 'website'`, `userId`. The command prints instead; both are in the activity log | `api/admin/config.ts` |
| `ai_agent.openai_down` | error | The robot stopped placing calls: OpenAI did not answer the one-word check - `err`, its status and code only (`OpenAI 401 invalid_api_key`, `OpenAI timed out`). Once when it starts | `worker/index.ts` |
| `ai_agent.fallbacks_paused` | error | The robot stopped placing calls: her last three calls all fell back - `minutes`, the pause (15). Once when it starts. She is asked about only when there is room to place calls, so a look with nobody free leaves either stop standing - no `auto_call.dialling_again` until she has been asked again (`stopChange`, `worker/auto-calls.ts`) | `worker/index.ts` |
| `ai_relay.started` | info | She took the call: `callId`, `leadId`, `callSid` | `ai/relay.ts` |
| `ai_relay.refused` | warn | A connection refused, `reason`: `not_found` (another path, with the `path`), `bad_signature` (usually a wrong `PUBLIC_URL`), `no_setup` (something else came first - `first`, its type - or nothing within 10 seconds), `bad_setup` (no call named), or why the call could not be hers - `already_started`, `over`, `other_call`, `not_automated`, `no_such_call`; `reconnect: true` for a reconnect refused | `ai/relay.ts` |
| `ai_relay.closed` | info | The session ended: the WebSocket `code`, how many `turns` were kept, and `ended` - whether her part had ended before it closed; false is a hang-up or Twilio's side ending it | `ai/relay.ts` |
| `ai_relay.second_setup`, `ai_relay.bad_message` | warn | Ignored; the call goes on | `ai/relay.ts` |
| `ai_relay.twilio_error` | warn | Twilio reported an error; what it said is kept as a turn, since it can quote her words | `ai/relay.ts` |
| `ai_relay.turn_not_saved` | error | A turn the database refused: `who`. The call goes on | `ai/relay.ts` |
| `ai_relay.failed` | error | The relay itself failed: once she is on the call, her part ends with the fallback (`relay_failed`); before that, the socket is closed (code 1011) | `ai/relay.ts` |
| `ai_relay.socket_error` | warn | Her part ends with the fallback (`socket_error`) | `ai/relay.ts` |
| `ai_relay.no_script` | error | No call script active at `setup`; the session closed before she started | `ai/relay.ts` |
| `ai_relay.end_not_saved` | error | Her action could not be recorded on the call: `action`. The call ends as she chose all the same | `ai/relay.ts` |
| `ai_relay.who_failed` | error | Who is there could not be read; taken as nobody | `ai/relay.ts`, `ai/conversation.ts` |
| `ai_relay.resumed` | info | Twilio reconnected and the call was picked back up: `leadId`, `attempt` (Twilio's count, or null), `turns` (kept so far), and `answering` - the lead had said something she then answered at once - or `ended`, the action she had already chosen, carried out | `ai/relay.ts` |
| `ai_relay.replaced` | warn | A reconnect while this api still held the call's old line, which was cut | `ai/relay.ts` |
| `ai_relay.reply` | info | One per reply: `who` (who was there), `latencyMs` (the lead's words reaching us to her first sentence going out), `firstWordMs` (to OpenAI's first word - the rest is the first sentence being written whole), `sentences`, `replaced` (the sentence check replaced one), `action` (or null), `stopped` (`talked_over`, `lead_said_more`, `call_closed` - the sentences already sent are kept as her turn and nothing more is sent - or null), `filler` ("One moment..." was said), `unsaid` (sentences written after a question and never said, her action waiting for the answer) | `ai/conversation.ts` |
| `ai_relay.ended` | info | The session ended with her action, or the relay's own ending: `action`, and `reason` - for `end_call`, hers (`not_interested`, `wrong_person`, `emergency`, `other`) or the relay's (`no_response`, `time_limit`); for `fallback`, why (`model_failed`, `model_slow`, `socket_error`, `relay_failed`) | `ai/conversation.ts` |
| `ai_relay.model_failed` | error | OpenAI failed; her part ends with the fallback - not when the call closed while she was thinking (a voicemail's beep took it, the lead hung up). `err` is only OpenAI's status and code, never its message, which can quote part of the key | `ai/conversation.ts` |
| `ai_relay.empty_reply` | warn | A reply with neither words nor an action when her brain had something to say. A silence the brain chose - a voicemail's greeting, an "okay" with no question open - is not one | `ai/conversation.ts` |
| `ai_relay.filler` | warn | No first word from OpenAI in 4 seconds: "One moment..." said, `waitedMs` | `ai/conversation.ts` |
| `ai_relay.model_slow` | error | Still none 4 seconds later: the fallback, `waitedMs` | `ai/conversation.ts` |
| `ai_relay.still_there` | info | The lead silent 6 seconds: "are you still there?" said, with `heldMs`, how long noises with no words held that silence | `ai/conversation.ts` |
| `ai_relay.wrap_up` | info | Three minutes in: the note to wrap up went with her reply | `ai/conversation.ts` |
| `ai_relay.verdict_wait` | info | An action that ends the call waited for Twilio's verdict on who answered: `action`, `waitedMs`, `verdict` - `in`, `taken` (the voicemail message took the call, nothing ended) or `none` after 15 seconds. Not logged when the verdict was already in | `ai/conversation.ts` |
| `ai_relay.heard_anyway` | info | Twilio said nothing was heard when the lead talked over her, but her first sentence had gone out `sinceMs` before (2 seconds or more), so that sentence is taken as heard rather than all of her reply as unsaid - also when her reply had all gone out before Twilio said so | `ai/conversation.ts` |
| `ai_brain.turn` | info | One per reply: `understood` (`fast` - a bare yes or no read without OpenAI; `openai` - the understand step; `early` - started while the lead was still speaking, and used; `refused` - after an action the call's check refused), `understandMs` (the wait on understanding once the lead had finished - 0 when not asked, often near 0 when `early`), `partials` (the lead's words still being said that came this turn), `lastPartialMs` (how long before the final words the last of them came, or null), `headStartMs` (how long understanding had run when the final words came - null unless `early`), `acts` (how many), `moves` (the policy's moves, by kind: `answer,offer`), `action` (or null) | `ai/brain.ts` |
| `ai_brain.unreadable` | warn | The understand step's answer could not be read: taken as a line not made out, and she asks them to say it again | `ai/brain.ts` |
| `ai_policy.guard` | warn | The call's own check (`toHandoff`) refused an action the policy chose - a policy fault: the safe move is said instead, never the action | `ai/brain.ts` |

### Transcripts and errors

| Event | Level | When, and its fields | File |
|---|---|---|---|
| `transcript.tick` | info | Only when something moved: `requested`, `completed`, `failed`, `waiting` (`TWILIO.md`, "Recordings and transcripts") | `worker/index.ts` |
| `transcript.tick_failed` | error | The pass failed | `worker/index.ts` |
| `transcript.request_failed` | warn | Twilio would not take a transcript request: `transcriptId`, `callId`, `gaveUp` | `worker/transcripts.ts` |
| `transcript.read_failed` | warn | A finished transcript could not be read | `worker/transcripts.ts` |
| `http.unhandled` | error | An error no route handled: `method`, `path` (the EZ Texting webhook as `/api/webhooks/eztexting/:token`), `err` | `api/http.ts` |

### Not logged, or not as JSON

| What | Why |
|---|---|
| `POST /api/calls/ringable` | Each open browser says whether it can take a call every 30 seconds - two lines a minute per agent, saying nothing new. Its state is `users.ringable_until`; a failure still reaches `http.unhandled` |
| `src/cli/create-superadmin.ts`, `src/cli/twilio-configure.ts`, `src/cli/send-waiting-openers.ts`, `src/cli/ai-agent.ts` | They print with `console` to a person's terminal. The superadmin command prints a one-time password, which must never become a shipped log line; Seri's switch is an activity-log row, `ai_agent.switched` |
| The resend after an outage | Prints its list for the person running it; run with `docker compose exec`, its output stays in that terminal. The sender it shares with the retry (`worker/opener.ts`, `db/outbound.ts`) writes only `sms.name_dropped`, `sms.unconfirmed` and `sms.record_failed`; `sms.sent` and `sms.failed` are the poller's and the retry's own. Each text is a `messages` row (`POLLER.md`, "Resending after an outage") |
| `src/ai/evals/understand-run.ts`, `src/ai/evals/speak-run.ts` | Seri's test sets, run by hand (`AI-AGENT.md`) |
| `scripts/migrate.js`, `src/config.ts` | `config.ts` runs before anything else exists, to say which env var is missing |

## Health endpoint

`GET /api/health` answers `{"status":"ok"}` and touches neither the database nor
the worker: it proves the api process is alive, for a Caddy or container check
(none is configured). A test asserts it never reaches the database, since that is
the whole difference between the two.

`GET /api/admin/health` is the deep check, superadmin only, for Admin > Overview's
System card (`db/health.ts`, `api/admin/health.ts`). Six checks - five from
`db/health.ts`, and `calling`, added by the route - each with its own `status`, a
`message` when degraded, and a `detail` object. The top-level `status` is
`degraded` if any check is; `info` never makes it so. It answers 200 even when
degraded: the report is the point, and a monitor reading only the status code would
see a hard failure for a slightly late poll.

| Check | Degrades when |
|---|---|
| `database` | `SELECT 1` fails. Nothing below runs: the response returns early rather than letting more queries fail in turn |
| `poller` | EZ Texting was last read over 6 minutes ago, or never has been |
| `webhook` | Never - its status is `info`: a quiet night is not a broken webhook. It reports the last inbound reply we stored, for a person to read - not every webhook: a request we ignored, and Twilio's, do not move it |
| `expiry` | An open conversation is more than 10 minutes past its `expires_at`. The worker sweeps every cycle, every 30 seconds by default, so that is many missed sweeps, not one slow one. It also reports how many are due but not yet swept |
| `sending` | `EZT_SEND_GROUP` is unset, so `sendMessage` refuses every send - or the newest send attempt of the last day was refused by EZ Texting. It reports the day's failures and the last successful send; a refused send is kept, marked failed (`db/failed-sends.ts`) |
| `calling` | The phone number or the TwiML App does not point at this server, the number is not on the account, or Twilio could not be asked. With calling not set up it is `info` |

**The poller's liveness is when it last read EZ Texting, not the checkpoint's
value.** The poller writes `ezt_last_read_at` on every poll that read the account,
failed contacts or not (`db/poll-state.ts`, `LAST_READ_AT_SQL`); a database whose
worker has not polled since that row existed falls back to the checkpoint row's
`updated_at`, which every poll writes too. The checkpoint's value is the newest
contact's `createdAt`, which stands still on a quiet account while the worker polls
every 30 seconds, and is held back behind a contact that failed. The value is in the
response beside the time, so the two are not confused. `scripts/health-live-check.ts`
pins it every way: a week-old value with a fresh poll is healthy, a fresh value with
a 15-minute-old poll is not; a fresh read with a 15-minute-old checkpoint is healthy,
a 15-minute-old read with a fresh checkpoint is not; without the row, the
checkpoint's time. The
worker has no HTTP server, so what it writes is the honest signal that it is alive.
6 minutes is twelve 30-second cycles: a slow EZ Texting page or a restart is not a
false alarm, and a dead worker is noticed within the working hour.

**Calling is checked against Twilio, not the database**
(`integrations/twilio-health.ts`). Twilio asks two addresses how to handle a call -
the TwiML App's Voice URL for a call a browser places, the phone number's for a lead
calling in - and if either points somewhere else, calls simply stop arriving: nothing
crashes and nothing is logged, because the request never reaches us. `twilio:configure`
refuses to move production's number from a laptop (`TWILIO-SETUP.md`, "What it needs on the
Twilio account"), which leaves a change made by hand in the Twilio Console as the
usual cause. So the check asks Twilio where both point and compares them with
`PUBLIC_URL`; its message says which is wrong, and to run `npm run twilio:configure`
on this server. Twilio is asked at most once a minute - the Overview page polls every
five seconds - so a fix shows within a minute. It reports where the two point, never
a credential, and places no call: it proves the wiring, not that a phone rings.

**Anything watching from outside needs a session,** so an uptime service cannot poll
the deep check. If one is wanted, it gets a separate unauthenticated route returning
less - not this guard removed.

## Decisions

| Decision | By | Date |
|---|---|---|
| Structured JSON lines, and never a phone number, message body, name, password, token or the EZ Texting credentials - enforced in the logger, not left to call sites | Jeel | 2026-09-23 |
| The deep health check is superadmin-only: it says how the business is doing, not just whether a process is up. External monitoring would get its own unauthenticated route returning less | Jeel | 2026-09-23 |
| Every health check judges what really happens - real sends, a real sweep - not a setting ("i want all real") | Jeel | 2026-09-28 |

## How to add an entry

1. Log with `log.info`, `log.warn` or `log.error` from `lib/log.ts`: a dotted event
   name, ids in their own fields, never a number, a body, a name or a secret - and
   never what was said or heard. `error` only for what someone should be woken for.
2. In the same commit, its row in "Events in use", in its area's table - event,
   level, when and its fields, file - and a History line. A new event that is not
   here is one nobody querying the logs will know to look for.

## History

- 2026-11-28 · `poll.contact_failed`, and `failed` on `poll.tick`; the `poller` check reads when EZ Texting was last read (`ezt_last_read_at`), the checkpoint's `updated_at` its fallback · B06
- 2026-11-27 · Rewritten as a reference: one row per event from a grep of `log.info|warn|error` in `backend/src` - 135 events; rows of their own for `call.ring_not_taken`, `call.closed_late`, `call.close_late_failed`, `call.left_open_watch_failed`, `auto_call.ring_not_taken`, `twilio.request_failed` and `auto_calls.test_numbers_invalid`, which were sentences inside other rows; "The two ways this system goes quiet" and the CloudWatch note handed to `DEPLOY.md` · D11
- 2026-11-24 · `ai_agent.switched`, Seri's switch changed from Admin > Configuration
- 2026-11-23 · `ai_relay.empty_reply` no longer warns on a silence her brain chose · review R9
- 2026-11-22 · From the review: an E.164 number inside any text is redacted - a send refused for a blocked number carried the number in its error's message, which every `sms.failed` line logged (H1); `http.unhandled` logs the EZ Texting route as `:token` - the last error handler logged the webhook's address, secret token and all, when the database failed before the handler's own `try` (H2); `call.unknown_take` logs `toBrowser`, never Twilio's `To` (H3); `call.closed_late` and its failures (H4); `call.ring_not_taken` and `auto_call.ring_not_taken` (H9); `ai_relay.reply`'s `stopped: 'call_closed'` (M6); `ai_relay.heard_anyway` also when her reply had all gone out - before, all of it counted as heard (M1; A34's calls 136, 137); `webhook.ignored` with `bad_fields` (M13); `worker.another_running` and `worker.cycle_failed` (M14); `sms.unconfirmed` the only line for a timed-out send, and `opener.retry`'s `unconfirmed` (M15); `twilio.request_failed` - Twilio's errors had been swallowed, a call already over and a refused key alike (M23); `auto_calls.test_numbers_invalid` (M25)
- 2026-11-19 · `ai_relay.written_action` removed with today's brain: it warned when the brain wrote her action in square brackets instead of taking it, and the relay took it (from A21); the new brain's action is decided in code. Its answer test set's runner, src/ai/evals/run.ts, removed too
- 2026-11-18 · `ai_brain.turn` gains `early`, `partials`, `lastPartialMs`, `headStartMs` · A33
- 2026-11-17 · `ai_brain.turn`, `ai_brain.unreadable`, `ai_policy.guard` · A30
- 2026-11-13 · `ai_relay.resumed`, `ai_relay.replaced`, `ai_relay.refused` with `reconnect`, `api.stopping` with `seriCalls` - the line dropping; and a stop for OpenAI or Seri's fallbacks no longer followed by `auto_call.dialling_again` until she has been asked again
- 2026-11-12 · The relay's events (A10-A12), `auto_call.answered`'s `to` (A13), `auto_call.ai_after` (A14), `auto_call.callback_booked` and `callback_time_refused` (A15), `ai_agent.openai_down` and `fallbacks_paused`, with `openai_down` and `ai_fallbacks` in `auto_call.dial`'s `stopped` (A17), `ai_relay.verdict_wait` (A18)
- 2026-11-11 · `ai_agent.no_key` (A01); `api.refused_start` with `ai_knowledge_invalid`, and `api.started` with `knowledge` (A03)
- 2026-10-29 · `auto_call.not_placed`, `auto_call.twilio_refusing` · T28
- 2026-10-24 · `auto_call.dial` and the robot's stops, `auto_call.dialling_again`, `auto_call.hold_closed` (T20); `auto_call.verdict`, `verdict_failed`, `after_takeover` - `auto_call.machine`, logged by the transfer when a machine answered, gone (T18); `call.incoming` with `ring: 'group'`, `call.taken`, `call.take_refused`, `call.unknown_take`, `call.take_failed`, `call.end_not_recorded` (T19)
- 2026-10-22 · `auto_call.offer`, `offer_ringing`, `offer_not_taken`, `offer_failed` · T17
- 2026-10-21 · `auto_call.hold`, `hold_ended`, `hold_recheck`, `hold_failed`, `hold_watch_failed` · T16
- 2026-10-20 · `auto_call.transfer`, `holder_not_taken`, `transfer_missed`, `transferred`, `transfer_refused`, `claim_failed`, `after_failed` (T15a, T15b); `ring_missed`, `rings_unread`, `switch_off_failed` (T15c)
- 2026-10-19 · `auto_call.answer` (T13); the link's texts logged with `key: call_link_text` (T14)
- 2026-10-18 · `auto_call.placed`, `refused`, `failed`, `unconfirmed`, `link_failed`, `answered`, `unknown_call`, `no_script`, `broken_script`, `answer_failed`, `gather_failed` (T12); `auto_calls.off` and `worker.started`'s `autoCalls` (T10, T20)
- 2026-10-16 · `twilio:configure` refuses to move production's number from a laptop, until then the usual cause of what the `calling` check catches
- 2026-10-05 · The first question keeps `key: question_1` though its words come from the flow; a reply's text logs `flow`
- 2026-10-02 · The `calling` health check
- 2026-10-01 · Browser calling's events, `call.*`, `twilio.*` and `calling.off` · Phase 4
- 2026-09-28 · Structured logging built (Phase 3 task 26). Six lines in `webhooks.ts` were logging raw phone numbers into logs that ship off the instance; after the change a real webhook was fired and the number appeared nowhere. `svc` worked out from the entry point: on the first run every worker line said `svc: "api"`. The first event list named three never built - `webhook.received`, `lead.created`, `auth.login_failed`; a failed sign-in is in the activity log (`AUDIT.md`)
- 2026-09-28 · The health checks made real (Jeel: "i want all real"): `webhook` and `expiry` had always said `ok`, and `sending` said `ok` while EZ Texting refused every text, as it checked only the setting. The poller had written its checkpoint only when a new contact arrived, so `updated_at` stood still on a quiet account and the `poller` check called a healthy worker degraded; it is now written on every successful poll. A paragraph here had said expiry never set the verdict
- 2026-09-26 · The deep health endpoint built (Phase 3 task 13)
