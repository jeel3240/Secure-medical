import { useEffect, useRef, useState } from 'react';
import { toApiError } from '../../api/client';
import { sendAgentSms, SMS_LIMIT, type LeadDetail } from '../../api/workspace';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';

/**
 * The composer at the foot of the conversation. DESIGN-PROMPT.md 3, "SMS
 * button"; redesigned 2026-09-28 from a collapsed panel into a message box,
 * because the centre column now reads as a thread and a thread ends in one.
 *
 * **Sending stops the automated questions, for good.** STATE-MACHINE.md rule
 * 2b: once an agent texts, the lead is talking to a person, and an automated
 * "Question 2 of 3" landing on top of that reads as a broken system. The
 * warning appears as soon as there is something to send and before the first
 * send, never after, because it cannot be undone - and the response's
 * `tookOver` says whether this send was the one that did it.
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

export function SmsCompose({
  lead,
  refresh,
  focusKey = 0,
  canAct,
}: {
  lead: LeadDetail;
  refresh: () => Promise<void>;
  /** Bumped by the header's Send SMS button to put the cursor in the box. */
  focusKey?: number;
  /** False on a lead you have not picked. */
  canAct: boolean;
}) {
  const [body, setBody] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusKey > 0) box.current?.focus();
  }, [focusKey]);

  const blocked = lead.flags.dnc;
  const remaining = SMS_LIMIT - body.length;
  const tooLong = remaining < 0;
  const alreadyTakenOver = Boolean(lead.conversation?.agentTookOverAt);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      // No "Sent." banner - Jeel, 2026-09-28. The message appears in the thread
      // with a tick, and a first send adds the "automated questions stopped"
      // marker there too, so a box saying so again was noise.
      await sendAgentSms(lead.id, body.trim());
      setBody('');
      setTemplatesOpen(false);
      await refresh();
    } catch (err) {
      const problem = toApiError(err);
      if (problem.code === 'send_failed') {
        // EZ Texting refused it. The server kept it as a failed message, so it
        // is in the thread with a red "!" - the way a phone shows it - and an
        // error box here would say the same thing twice.
        setBody('');
        setTemplatesOpen(false);
        await refresh();
      } else {
        // Nothing was kept - a blocked number, a lead no longer yours - so the
        // text stays in the box and the reason is shown.
        setError(problem.message);
      }
    } finally {
      setSending(false);
    }
  };

  if (blocked) {
    // Not merely disabled: there is nothing to compose. sendMessage refuses a
    // blocked number anyway, so a form here would only produce a 409.
    return <p className="composer__blocked">Texting is blocked - this number is on the do-not-call list.</p>;
  }

  return (
    <fieldset className="composer" disabled={!canAct}>
        {error && <Banner tone="error">{error}</Banner>}

        {/* Shown once there is something to send, and only before the first
            send: it cannot be undone. */}
        {!alreadyTakenOver && body.trim() !== '' && (
          <p className="composer__warning">
            Sending stops the automated questions for this lead. You will be handling the
            conversation from here.
          </p>
        )}

        {templatesOpen && (
          <div className="composer__templates">
            {TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                className="chip-button"
                onClick={() => {
                  setBody(template.body(lead));
                  setTemplatesOpen(false);
                  box.current?.focus();
                }}
              >
                {template.label}
              </button>
            ))}
          </div>
        )}

        <div className="composer__row">
          <button
            type="button"
            className="composer__templates-toggle"
            aria-expanded={templatesOpen}
            onClick={() => setTemplatesOpen((v) => !v)}
            title="Canned messages"
          >
            Templates
          </button>

          <textarea
            ref={box}
            className="composer__box"
            rows={1}
            value={body}
            maxLength={SMS_LIMIT}
            placeholder={`Write a message to ${lead.firstName ?? 'this lead'}...`}
            aria-label="Message"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter makes a new line - a thread's usual
              // shortcut. The button stays for anyone who does not know it.
              if (e.key === 'Enter' && !e.shiftKey && body.trim() && !sending) {
                e.preventDefault();
                void send();
              }
            }}
          />

          {body.length > 0 && (
            <span className={`composer__count tabular${remaining <= 20 ? ' composer__count--low' : ''}`}>
              {remaining}
            </span>
          )}

          <Button
            className="composer__send"
            loading={sending}
            disabled={!body.trim() || tooLong}
            onClick={() => void send()}
          >
            Send
          </Button>
        </div>
    </fieldset>
  );
}
