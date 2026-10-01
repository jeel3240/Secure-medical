import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toApiError } from '../../api/client';
import { addNote } from '../../api/workspace';
import { useEscape } from '../../components/useDismiss';
import { callClock, endedText, type CallState } from '../../lib/call-state';
import { formatPhone } from '../../lib/format';
import type { LeadCall } from './useLeadCall';

/**
 * The call bar: a call in progress, docked at the foot of the screen - Jeel's
 * design, 2026-10-01. TWILIO.md, "The screen".
 *
 *   [PS] Priya S. (555) 010-0016      0:42   | Mute  Keypad |  End
 *        Connected
 *
 * It slides up when Call is pressed and stays put while the agent scrolls the
 * conversation or types in Wrap up, so the controls are never off screen. When
 * the call ends it becomes a note box - "what happened on that call?" asked at
 * the moment the agent knows the answer - and goes away once the note is saved
 * or skipped.
 *
 * Nothing is shown while no call is being placed, is live, or has just ended.
 *
 * Also the bar for a call a lead placed to us, once it is answered
 * (`layout/IncomingCallBar.tsx`): from there on it is the same call, so it is
 * the same bar. That is why it takes a name and a number, not a lead.
 *
 * **No Hold.** The design has one. A real hold - the lead hears music and is
 * brought back - needs the call set up as a conference on the server, which
 * Phase 4 did not build; a button that only muted would be a lie. TWILIO.md,
 * "Not built".
 */
export interface CallParty {
  /** The lead a note about the call is saved to. */
  leadId: number;
  /** As shown; empty when the lead has no name. */
  name: string;
  phone: string;
}

/** What the bar needs of a call: the workspace's own, or an answered incoming one. */
export type BarCall = Pick<LeadCall, 'state' | 'hangUp' | 'setMuted' | 'sendDigits' | 'dismiss'>;

export function CallBar({
  who,
  call,
  now,
  onNoteSaved,
}: {
  who: CallParty;
  call: BarCall;
  /** Ticks every second, for the clock. */
  now: Date;
  /** A note was saved from the bar: reload what the page shows. */
  onNoteSaved: () => void;
}) {
  const { state } = call;
  if (state.phase === 'idle') return null;

  return (
    <div className={`call-bar call-bar--${state.phase}`} role="region" aria-label="Call">
      <div className="call-bar__who">
        <span className="call-bar__avatar" aria-hidden="true">
          {initials(who.name)}
          <span className={`call-bar__presence call-bar__presence--${presence(state)}`} />
        </span>
        <div className="call-bar__id">
          <p className="call-bar__name">
            {who.name}
            <span className="call-bar__phone tabular">{formatPhone(who.phone)}</span>
          </p>
          <p className="call-bar__state" role="status">
            {stateText(state)}
          </p>
        </div>
      </div>

      {state.phase === 'ended' && <AfterCall leadId={who.leadId} onDone={call.dismiss} onSaved={onNoteSaved} />}

      {state.phase === 'failed' && (
        <button type="button" className="call-bar__button call-bar__button--plain" onClick={call.dismiss}>
          Dismiss
        </button>
      )}

      {(state.phase === 'connecting' || state.phase === 'ringing' || state.phase === 'live') && (
        <InCall state={state} call={call} now={now} />
      )}
    </div>
  );
}

/** `Maria Reyes` and `Maria R.` -> `MR`. */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    // Letters only: a lead with no name is shown by number, which has no initials.
    .map((part) => (/^\p{L}/u.test(part) ? part[0].toUpperCase() : ''))
    .join('')
    .slice(0, 2);
  return letters || '#';
}

function presence(state: CallState): 'live' | 'dialing' | 'off' {
  if (state.phase === 'live') return 'live';
  return state.phase === 'connecting' || state.phase === 'ringing' ? 'dialing' : 'off';
}

function stateText(state: CallState): string {
  switch (state.phase) {
    case 'connecting':
      return 'Connecting…';
    case 'ringing':
      return 'Ringing…';
    case 'live':
      return state.muted ? 'Connected · muted' : 'Connected';
    case 'ended':
      return endedText(state);
    case 'failed':
      return state.message;
    case 'idle':
      return '';
  }
}

/** The clock and the controls, while a call is being placed or is live. */
function InCall({ state, call, now }: { state: CallState; call: BarCall; now: Date }) {
  const [keypad, setKeypad] = useState(false);
  const live = state.phase === 'live';
  const seconds = live ? Math.max(0, (now.getTime() - state.since) / 1000) : 0;

  useEscape(keypad, () => setKeypad(false));

  return (
    <>
      <span className="call-bar__clock tabular" role="timer" aria-label="Call length">
        {callClock(seconds)}
      </span>

      <div className="call-bar__tools">
        {/* Mute and the keypad act on a connected call; before the lead
            answers there is nobody to mute and nothing to dial into. */}
        <ToolButton
          label={live && state.muted ? 'Unmute' : 'Mute'}
          pressed={live && state.muted}
          disabled={!live}
          onClick={() => live && call.setMuted(!state.muted)}
        >
          <MicIcon off={live && state.muted} />
        </ToolButton>
        <ToolButton label="Keypad" pressed={keypad} disabled={!live} onClick={() => setKeypad((open) => !open)}>
          <KeypadIcon />
        </ToolButton>
      </div>

      <button type="button" className="call-bar__button call-bar__button--end" onClick={call.hangUp}>
        <HangUpIcon />
        End
      </button>

      {keypad && live && <Keypad onDigit={call.sendDigits} />}
    </>
  );
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="call-bar__tool" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
      <span>{label}</span>
    </button>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

/** Tones for a phone menu or an extension. Shows what was pressed, since a tone cannot be seen. */
function Keypad({ onDigit }: { onDigit: (digit: string) => void }) {
  const [pressed, setPressed] = useState('');
  return (
    <div className="call-bar__keypad" role="group" aria-label="Keypad">
      <p className="call-bar__dialed tabular" aria-live="polite">
        {pressed || ' '}
      </p>
      <div className="call-bar__keys">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="call-bar__key"
            onClick={() => {
              onDigit(key);
              setPressed((sofar) => (sofar + key).slice(-16));
            }}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The note box a finished call turns into. Saved straight to the lead's notes -
 * the same note Wrap up writes - so it shows in the Notes card at once. Skip
 * is always there: not every call needs a note.
 */
function AfterCall({ leadId, onDone, onSaved }: { leadId: number; onDone: () => void; onSaved: () => void }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // The agent's hands are on the keyboard the moment the call ends.
  useEffect(() => input.current?.focus(), []);

  const save = async () => {
    const body = note.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addNote(leadId, body);
      onSaved();
      onDone();
    } catch (err) {
      setError(toApiError(err).message);
      setSaving(false);
    }
  };

  return (
    <form
      className="call-bar__after"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="call-bar__note-wrap">
        <input
          ref={input}
          className="call-bar__note"
          value={note}
          maxLength={5000}
          placeholder="Add a note about this call…"
          aria-label="Note about this call"
          onChange={(event) => setNote(event.target.value)}
        />
        {error && (
          <p className="call-bar__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="call-bar__button call-bar__button--save" disabled={!note.trim() || saving}>
        {saving ? 'Saving…' : 'Save note'}
      </button>
      <button type="button" className="call-bar__button call-bar__button--plain" onClick={onDone}>
        Skip
      </button>
    </form>
  );
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" strokeLinecap="round" />
      {off && <path d="M3.5 3.5l13 13" strokeLinecap="round" />}
    </svg>
  );
}

function KeypadIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
      {[4, 10, 16].flatMap((cx) => [4, 10, 16].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.4" />))}
    </svg>
  );
}

function HangUpIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path
        d="M2.5 12c0-1 .5-2 1.5-2.6C5.800 8.300 7.800 7.800 10 7.800s4.200.5 6 1.600c1 .6 1.500 1.600 1.500 2.600v.8c0 .5-.4.8-.9.7l-2.800-.6c-.4-.1-.6-.4-.6-.8v-1.300c-1-.4-2.100-.6-3.200-.6s-2.200.2-3.200.6v1.300c0 .4-.300.700-.6.800l-2.800.6c-.5.100-.9-.2-.9-.7V12z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
