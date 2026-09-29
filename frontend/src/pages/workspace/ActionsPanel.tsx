import { useEffect, useState } from 'react';
import { toApiError } from '../../api/client';
import {
  addNote,
  createCallback,
  setDisposition,
  type Disposition,
  type LeadDetail,
} from '../../api/workspace';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { toLocalInput } from '../../lib/format';

/**
 * The workspace's right column: outcome, callback, note, Save.
 *
 * DESIGN-PROMPT.md 3, "Right column". Phase 3 task 19.
 *
 * **One button, Save - Jeel, 2026-09-28.** There was also "Save & next lead",
 * which saved, released the lead and opened the top of the queue. It was
 * dropped: the agent stays on the lead after saving, and leaves with Back to
 * queue, which releases it. One way out, and nothing moves them on to a lead
 * they did not choose.
 *
 * **One Save, three writes.** The brief has a single Save for all three
 * controls, so this posts whichever the agent filled in. They are separate
 * endpoints and separate rows - `AGENT-WORKSPACE.md` - and each is append-only,
 * so a partial failure leaves whatever succeeded. The panel says which part
 * failed rather than claiming the whole save went wrong.
 *
 * **DNC asks twice.** The API refuses `dnc` without `confirmDnc: true`; this is
 * the dialog in front of that, and it says what the block actually does. Only a
 * START from the lead lifts it.
 */

/** Quick chips from the brief, plus the datetime field for anything else. */
const QUICK: { label: string; at: () => Date }[] = [
  {
    label: 'In 1 hour',
    at: () => new Date(Date.now() + 3600_000),
  },
  {
    label: 'Tomorrow 10 AM',
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      return d;
    },
  },
  {
    label: 'Tomorrow 3 PM',
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(15, 0, 0, 0);
      return d;
    },
  },
];

/**
 * The two outcomes - Jeel, 2026-09-28. **Closed** finishes the lead: it leaves
 * the queue once the agent goes back. **DNC** blocks the number for good, so it
 * asks first. There were eight, grouped Positive / No contact / Negative; the
 * requirement asks for none of them, and "no answer" or "call back Friday" is
 * what the callback and the note are for. `AGENT-WORKSPACE.md`, "Dispositions".
 */
const OUTCOMES: { value: Disposition; tone: 'good' | 'danger'; label: string }[] = [
  { value: 'closed', tone: 'good', label: 'Closed' },
  { value: 'dnc', tone: 'danger', label: 'DNC' },
];

export function ActionsPanel({
  lead,
  refresh,
  canAct,
}: {
  lead: LeadDetail;
  refresh: () => Promise<void>;
  /** False on a lead you have not picked: everything below is switched off. */
  canAct: boolean;
}) {
  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [disposition, setDispositionValue] = useState<Disposition | null>(null);
  const [confirmingDnc, setConfirmingDnc] = useState(false);
  const [picking, setPicking] = useState(false);

  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  const dirty = note.trim() !== '' || callbackAt !== '' || disposition !== null;

  /**
   * The unsaved-changes guard the brief asks for, for the case that actually
   * loses work: closing the tab or hitting back. An in-app navigation cannot be
   * intercepted without a router data API this app does not use.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /**
   * Posts whatever the agent filled in, collecting failures rather than
   * stopping at the first.
   */
  const save = async (): Promise<void> => {
    const failures: string[] = [];
    const done: string[] = [];

    if (note.trim()) {
      try {
        await addNote(lead.id, note.trim());
        done.push('note');
        setNote('');
      } catch (err) {
        failures.push(`Note: ${toApiError(err).message}`);
      }
    }

    if (callbackAt) {
      try {
        // datetime-local gives local time; the API wants an instant.
        await createCallback(lead.id, new Date(callbackAt).toISOString());
        done.push('callback');
        setCallbackAt('');
      } catch (err) {
        failures.push(`Callback: ${toApiError(err).message}`);
      }
    }

    if (disposition) {
      try {
        await setDisposition(lead.id, disposition, disposition === 'dnc');
        done.push('outcome');
        setDispositionValue(null);
      } catch (err) {
        failures.push(`Outcome: ${toApiError(err).message}`);
      }
    }

    setProblems(failures);
    setSaved(failures.length === 0 && done.length > 0 ? `Saved ${done.join(', ')}.` : null);
    await refresh();
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save();
    } finally {
      setSaving(false);
    }
  };

  const choose = (value: Disposition) => {
    // The block is lifted only by a START from the lead, so a mis-click must
    // not be able to set it - DESIGN-PROMPT.md 3 asks for the confirm too.
    if (value === 'dnc') {
      setConfirmingDnc(true);
      return;
    }
    setDispositionValue((current) => (current === value ? null : value));
  };

  return (
    <div className="card wrapup">
      <header className="wrapup__head">
        <h2 className="wrapup__title">Wrap up</h2>
      </header>

      {/* A disabled fieldset switches off every control inside it at once -
          outcome, callback, note, Save - so nothing can be missed.
          The server refuses the write anyway; this saves the agent the round
          trip. */}
      <fieldset className="wrapup__fieldset" disabled={!canAct}>
        {problems.length > 0 && (
          <Banner tone="error">
            {problems.map((p) => (
              <span key={p} className="actions-panel__problem">
                {p}
              </span>
            ))}
          </Banner>
        )}
        {saved && <Banner tone="success">{saved}</Banner>}

        <section className="wrapup__section">
          <h3 className="wrapup__legend">
            <span className="wrapup__num">1</span> Outcome
          </h3>

          <div className="wrapup__choices" role="radiogroup" aria-label="Outcome">
            {OUTCOMES.map((outcome) => (
              <button
                key={outcome.value}
                type="button"
                role="radio"
                aria-checked={disposition === outcome.value}
                className={`outcome outcome--${outcome.tone}${disposition === outcome.value ? ' outcome--on' : ''}`}
                onClick={() => choose(outcome.value)}
              >
                <span className="outcome__dot" aria-hidden="true" />
                {outcome.label}
              </button>
            ))}
          </div>
        </section>

        <section className="wrapup__section">
          <h3 className="wrapup__legend">
            <span className="wrapup__num">2</span> Callback
            <span className="wrapup__optional">Optional</span>
          </h3>
          <div className="wrapup__choices">
            {QUICK.map((quick) => (
              <button
                key={quick.label}
                type="button"
                className="chip-button"
                onClick={() => {
                  setCallbackAt(toLocalInput(quick.at()));
                  setPicking(false);
                }}
              >
                {quick.label}
              </button>
            ))}
            <button type="button" className="chip-button" onClick={() => setPicking(true)}>
              Pick time...
            </button>
          </div>
          {(picking || callbackAt !== '') && (
            <input
              type="datetime-local"
              className="actions-panel__input"
              value={callbackAt}
              onChange={(e) => setCallbackAt(e.target.value)}
              aria-label="Callback date and time"
            />
          )}
        </section>

        <section className="wrapup__section">
          <h3 className="wrapup__legend">
            <span className="wrapup__num">3</span> Note
          </h3>
          <textarea
            id="note"
            className="actions-panel__textarea"
            rows={4}
            value={note}
            placeholder={`What did ${lead.firstName ?? 'the lead'} say?`}
            onChange={(e) => setNote(e.target.value)}
          />
        </section>

        <div className="wrapup__save">
          <Button loading={saving} disabled={!dirty} onClick={() => void onSave()}>
            Save
          </Button>
        </div>
      </fieldset>

      {confirmingDnc && (
        <Modal
          title="Add to the do-not-call list?"
          onClose={() => setConfirmingDnc(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmingDnc(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDispositionValue('dnc');
                  setConfirmingDnc(false);
                }}
              >
                Yes, block this number
              </Button>
            </>
          }
        >
          <p>
            This suppresses <strong>{lead.phone}</strong> for SMS and calls everywhere. The lead
            leaves the queue and nothing can text them again.
          </p>
          <p>
            Only the lead can undo it, by texting START. There is no way to release the block from
            this app.
          </p>
        </Modal>
      )}
    </div>
  );
}
