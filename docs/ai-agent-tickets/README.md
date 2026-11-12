# Phase 7 tickets: Seri, the AI agent

The build of `docs/AI-AGENT.md`, split into small tickets. Each is one PR into `dev`, with its tests and docs in the same commit. Read the design first, then the ticket.

**How to work a ticket:** read the ticket and the files it names; build only what is under *Build*; tick every *Done when*; leave *Not in this ticket* alone. What was built differently from the ticket goes under *As built* in the ticket, and in the design.

| # | Ticket | Depends on | Size | Status |
|---|---|---|---|---|
| A01 | [Setup: packages, OpenAI key, on/off switch](A01-setup-packages-openai-key-on-off-switch.md) | - | S | Done 2026-11-11 |
| A02 | [Spike: first test call with ConversationRelay](A02-spike-first-test-call-with-conversationr.md) | A01 | S | Done 2026-11-12 |
| A03 | [Knowledge loader](A03-knowledge-loader.md) | - | S | Done 2026-11-11 |
| A04 | [Seri's instructions (system prompt)](A04-seri-s-instructions-system-prompt.md) | A03 | M | Done 2026-11-11 |
| A05 | [Sentence safety check](A05-sentence-safety-check.md) | A03 | S | Done 2026-11-11 |
| A06 | [Seri's five actions](A06-seri-s-five-actions.md) | A07 | S | Done 2026-11-11 |
| A07 | [Call-back time rules](A07-call-back-time-rules.md) | - | S | Done 2026-11-11 |
| A08 | [Migration 022](A08-migration-022.md) | - | S | Done 2026-11-11 |
| A09 | [Answer test set](A09-answer-test-set.md) | A04, A05, A06 | M | Done 2026-11-11 |
| A10 | [Relay part 1: connection and storage](A10-relay-part-1-connection-and-storage.md) | A01, A08 | M | To do |
| A11 | [Relay part 2: Seri talks (OpenAI)](A11-relay-part-2-seri-talks-openai.md) | A04, A05, A06, A10 | L | To do |
| A12 | [Relay part 3: limits and failures](A12-relay-part-3-limits-and-failures.md) | A11 | M | To do |
| A13 | [The call goes to Seri](A13-the-call-goes-to-seri.md) | A01, A10 | S | To do |
| A14 | [After Seri: carrying out her action](A14-after-seri-carrying-out-her-action.md) | A06, A13 | M | To do |
| A15 | [Seri books a call back](A15-seri-books-a-call-back.md) | A07, A08, A14 | S | To do |
| A16 | [Seri's call backs in the queue](A16-seri-s-call-backs-in-the-queue.md) | A15 | M | To do |
| A17 | [OpenAI checked before calling](A17-openai-checked-before-calling.md) | A12 | S | To do |
| A18 | [Voicemail and hang-ups while Seri talks](A18-voicemail-and-hang-ups-while-seri-talks.md) | A14 | S | To do |
| A19 | [Seri's conversation on the timeline](A19-seri-s-conversation-on-the-timeline.md) | A10 | S | To do |
| A20 | [End-to-end and live checks](A20-end-to-end-and-live-checks.md) | A13, A14, A15, A16, A17, A18, A19 | M | To do |
| A21 | [Every path on a real phone](A21-every-path-on-a-real-phone.md) | A20 | M | To do |
| A22 | [Deploy, then switch on](A22-deploy-then-switch-on.md) | A21 | S | To do |

Sizes: S a few hours, M about a day, L two days or more.

## Order

Tickets with nothing in *Depends on* can start any time. A suggested path:

1. **Foundations:** A01, A03, A08, then A02 (first test call, pick the voice)
2. **Seri's brain, pure and tested:** A04, A05, A07, A06, then A09 (test set, choose the model)
3. **The relay:** A10, A11, A12
4. **Into the call:** A13, A14, A15, A16, A17, A18, A19
5. **Prove it:** A20, A21
6. **Live:** A22
