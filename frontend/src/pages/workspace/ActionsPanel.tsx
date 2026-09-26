import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toApiError } from '../../api/client';
import { listQueue, releaseLead } from '../../api/leads';
import {
  addNote,
  createCallback,
  setDisposition,
  DISPOSITIONS,
  DISPOSITION_LABEL,
  type Disposition,
  type LeadDetail,
} from '../../api/workspace';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { lockHolder } from '../../lib/lock';
import { useAuth } from '../../auth/store';

/**
 * The workspace's right column: note, callback, disposition, Save and next.
 *
 * DESIGN-PROMPT.md 3, "Right column". Phase 3 task 19.
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
    label: 'Tomorrow 10am',
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      return d;
    },
  },
  {
    label: 'Tomorrow 3pm',
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(15, 0, 0, 0);
      return d;
    },
  },
];

/** `<input type="datetime-local">` wants local time with no zone, not an ISO string. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function ActionsPanel({
  lead,
  refresh,
}: {
  lead: LeadDetail;
  refresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);

  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [disposition, setDispositionValue] = useState<Disposition | null>(null);
  const [confirmingDnc, setConfirmingDnc] = useState(false);

  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  const dirty = note.trim() !== '' || callbackAt !== '' || disposition !== null;

  /**
   * The unsaved-changes guard the brief asks for, for the case that actually
   * loses work: closing the tab or hitting back. An in-app navigation cannot be
   * intercepted without a router data API this app does not use, and Save &
   * next - the usual way out - saves first anyway.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /**
   * Posts whatever the agent filled in, collecting failures rather than
   * stopping at the first. Returns true when everything asked for succeeded.
   */
  const save = async (): Promise<boolean> => {
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
        done.push('disposition');
        setDispositionValue(null);
      } catch (err) {
        failures.push(`Disposition: ${toApiError(err).message}`);
      }
    }

    setProblems(failures);
    setSaved(failures.length === 0 && done.length > 0 ? `Saved ${done.join(', ')}.` : null);
    await refresh();
    return failures.length === 0;
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save();
    } finally {
      setSaving(false);
    }
  };

  /**
   * Save, release this lead, and open the next one the agent may work.
   *
   * The next lead is the top of the queue that is not locked - the same rule
   * the queue screen uses, so "next" means what the agent would have clicked.
   * If the save failed, nothing moves: losing a note on the way to the next
   * lead is worse than an extra click.
   */
  const onSaveAndNext = async () => {
    setSaving(true);
    try {
      if (!(await save())) return;

      await releaseLead(lead.id).catch(() => {
        // Not fatal: a superadmin can force-release, and the agent should still
        // get their next lead.
      });

      const queue = await listQueue();
      const next = queue.leads.find((l) => l.id !== lead.id && !lockHolder(l, me));

      navigate(next ? `/leads/${next.id}` : '/queue');
    } catch (err) {
      setProblems([toApiError(err).message]);
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
    <div className="card actions-panel">
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

      <section className="actions-panel__section">
        <label className="actions-panel__label" htmlFor="note">
          Note
        </label>
        <textarea
          id="note"
          className="actions-panel__textarea"
          rows={4}
          value={note}
          placeholder="What did the lead say?"
          onChange={(e) => setNote(e.target.value)}
        />
      </section>

      <section className="actions-panel__section">
        <span className="actions-panel__label">Callback</span>
        <div className="actions-panel__chips">
          {QUICK.map((quick) => (
            <button
              key={quick.label}
              type="button"
              className="chip-button"
              onClick={() => setCallbackAt(toLocalInput(quick.at()))}
            >
              {quick.label}
            </button>
          ))}
        </div>
        <input
          type="datetime-local"
          className="actions-panel__input"
          value={callbackAt}
          onChange={(e) => setCallbackAt(e.target.value)}
          aria-label="Callback date and time"
        />
      </section>

      <section className="actions-panel__section">
        <span className="actions-panel__label">Disposition</span>
        <div className="actions-panel__dispositions" role="radiogroup" aria-label="Disposition">
          {DISPOSITIONS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={disposition === value}
              className={`disposition${disposition === value ? ' disposition--on' : ''}${
                value === 'dnc' ? ' disposition--danger' : ''
              }`}
              onClick={() => choose(value)}
            >
              {DISPOSITION_LABEL[value]}
            </button>
          ))}
        </div>
      </section>

      <div className="actions-panel__save">
        <Button variant="secondary" disabled={!dirty || saving} onClick={() => void onSave()}>
          Save
        </Button>
        <Button loading={saving} onClick={() => void onSaveAndNext()}>
          Save &amp; next lead
        </Button>
      </div>

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
