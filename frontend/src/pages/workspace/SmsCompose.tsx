import { useState } from 'react';
import { toApiError } from '../../api/client';
import { sendAgentSms, SMS_LIMIT, type LeadDetail } from '../../api/workspace';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';

/**
 * Inline SMS compose, under the actions panel. DESIGN-PROMPT.md 3, "SMS
 * button". Phase 3 task 20.
 *
 * **Sending stops the automated questions, for good.** STATE-MACHINE.md rule
 * 2b: once an agent texts, the lead is talking to a person, and an automated
 * "Question 2 of 3" landing on top of that reads as a broken system. The
 * warning below says so before the first send rather than after, because it
 * cannot be undone - and the response's `tookOver` says whether this send was
 * the one that did it.
 *
 * **160 characters.** One segment. Longer costs a second segment on every send,
 * so the count is a hard limit here rather than a suggestion - the API rejects
 * a longer body anyway.
 */

/**
 * The canned messages from the brief.
 *
 * Hardcoded, unlike the automated copy in `settings`: these are an agent's own
 * words mid-conversation, not the qualification flow, so a mistyped one costs a
 * single awkward message rather than reshaping every lead's experience. If the
 * client wants to edit them they move to `settings` like the rest.
 *
 * {first_name} is not substituted - these go out exactly as written, and an
 * agent editing the text before sending is the point of a template.
 */
const TEMPLATES: { label: string; body: (lead: LeadDetail) => string }[] = [
  {
    label: 'Missed you',
    body: (lead) => `Hi ${lead.firstName ?? 'there'}, tried to reach you just now - when is a good time to call?`,
  },
  {
    label: 'Following up',
    body: (lead) => `Hi ${lead.firstName ?? 'there'}, following up on your enquiry. Happy to answer any questions.`,
  },
  {
    label: 'Confirming callback',
    body: (lead) => `Hi ${lead.firstName ?? 'there'}, confirming our call. Reply here if you need to move it.`,
  },
  {
    label: 'Still interested?',
    body: (lead) => `Hi ${lead.firstName ?? 'there'}, are you still interested? Reply and I will pick it up from there.`,
  },
];

export function SmsCompose({ lead, refresh }: { lead: LeadDetail; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const blocked = lead.flags.dnc;
  const remaining = SMS_LIMIT - body.length;
  const tooLong = remaining < 0;
  const alreadyTakenOver = Boolean(lead.conversation?.agentTookOverAt);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const message = await sendAgentSms(lead.id, body.trim());
      setBody('');
      setOpen(false);
      setSent(
        message.tookOver
          ? 'Sent. The automated questions have stopped for this lead.'
          : 'Sent.'
      );
      await refresh();
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setSending(false);
    }
  };

  if (blocked) {
    // Not merely disabled: there is nothing to compose. sendMessage refuses a
    // blocked number anyway, so a form here would only produce a 409.
    return <p className="sms__blocked">Texting is blocked - this number is on the do-not-call list.</p>;
  }

  if (!open) {
    return (
      <>
        {sent && <Banner tone="success">{sent}</Banner>}
        <Button variant="secondary" block onClick={() => setOpen(true)}>
          Send SMS
        </Button>
      </>
    );
  }

  return (
    <div className="sms">
      {error && <Banner tone="error">{error}</Banner>}

      {/* Shown before the first send, not after: it cannot be undone. */}
      {!alreadyTakenOver && (
        <p className="sms__warning">
          Sending stops the automated questions for this lead. You will be handling the
          conversation from here.
        </p>
      )}

      <div className="sms__templates">
        {TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            className="chip-button"
            onClick={() => setBody(template.body(lead))}
          >
            {template.label}
          </button>
        ))}
      </div>

      <textarea
        className="actions-panel__textarea"
        rows={4}
        value={body}
        maxLength={SMS_LIMIT}
        placeholder="Type a message"
        aria-label="Message"
        onChange={(e) => setBody(e.target.value)}
      />

      <div className="sms__foot">
        <span className={`sms__count tabular${remaining <= 20 ? ' sms__count--low' : ''}`}>
          {remaining} left
        </span>
        <div className="sms__buttons">
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button loading={sending} disabled={!body.trim() || tooLong} onClick={() => void send()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
