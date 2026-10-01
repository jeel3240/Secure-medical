import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { claimLead } from '../api/leads';
import { getLead, getTimeline, type LeadDetail, type TimelineEntry } from '../api/workspace';
import { useAuth } from '../auth/store';
import { callClock } from '../lib/call-state';
import { askToNotify, notifyIncomingCall } from '../lib/call-notification';
import { callerContext } from '../lib/caller-context';
import { formatPhone, shortName } from '../lib/format';
import { useIncomingCall } from '../lib/incoming-call';
import { armRingtone, canRing, startRinging } from '../lib/ringtone';
import type { Caller } from '../lib/incoming-state';
import { useSecond } from '../lib/useSecond';
import { CallBar, initials } from '../pages/workspace/CallBar';
import { questionsLabel } from '../pages/workspace/LeadHeader';

/**
 * A lead calling our number, on whichever screen the agent is - TWILIO.md,
 * "Incoming calls".
 *
 * **A card, top right, that says who it is before the agent picks up** -
 * Jeel's design, 2026-10-01:
 *
 *   ● INCOMING CALL                         0:09
 *   [LM] Leo M.                           [WARM]
 *        (555) 010-0014
 *   Calling back · you tried 2× today
 *   Score       Interest     Flow
 *   45 / 100    Both         Stopped at Q2
 *   [ Decline ]              [ Accept ]
 *
 * Then, by what happens:
 *
 *   accepted  the ordinary call bar at the foot of the screen, then its note
 *             box - `CallBar.tsx`
 *   missed    a small notice in the same corner: "Missed call · Leo M. ·
 *             Rang for 20s", with Call back
 *
 * Mounted once, in the app shell, and it is also what makes this browser
 * ringable: it starts listening when someone is signed in and stops when they
 * are not.
 *
 * The name and number arrive with the call. The rest - tier, score, answers,
 * how often we tried them - is fetched when it starts to ring, so the card is
 * up at once and fills in a moment later.
 */
export function IncomingCall() {
  const { state, ringable, listen, answer, decline, dismiss, hangUp, setMuted, sendDigits } = useIncomingCall();
  const navigate = useNavigate();

  useEffect(() => listen(), [listen]);
  useEffect(() => armRingtone(), []);
  useEffect(() => (ringable ? askToNotify() : undefined), [ringable]);

  // It rings for as long as the card is up, and stops the moment it is
  // accepted, declined or missed.
  const ringing = state.phase === 'ringing';
  useEffect(() => (ringing ? startRinging() : undefined), [ringing]);

  // And a desktop notification, which reaches an agent whose browser is
  // behind another window, or is not yet allowed to play sound.
  const ringingCaller = state.phase === 'ringing' ? state.caller : null;
  useEffect(() => {
    if (!ringingCaller) return;
    return notifyIncomingCall(shownName(ringingCaller), ringingCaller.name ? formatPhone(ringingCaller.phone) : '');
  }, [ringingCaller]);

  // The tab says so too, for an agent looking at another one.
  useEffect(() => {
    if (!ringing) return;
    const title = document.title;
    document.title = 'Incoming call';
    return () => {
      document.title = title;
    };
  }, [ringing]);

  // A browser plays no sound on a page nobody has clicked on - after a reload,
  // say. Until then a call would arrive silently, so the agent is asked for
  // the one click that fixes it. Checked on each click and key press.
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    if (!ringable) return;
    const check = () => window.setTimeout(() => setSilent(!canRing()), 50);
    check();
    window.addEventListener('pointerdown', check);
    window.addEventListener('keydown', check);
    return () => {
      window.removeEventListener('pointerdown', check);
      window.removeEventListener('keydown', check);
    };
  }, [ringable]);

  if (state.phase === 'none') {
    return ringable && silent ? (
      <p className="incoming incoming--silent" role="status">
        Click anywhere to turn on the ring for incoming calls.
      </p>
    ) : null;
  }
  const { caller } = state;

  if (state.phase === 'call') {
    return <LiveCall caller={caller} call={{ state: state.call, hangUp, setMuted, sendDigits, dismiss }} />;
  }

  if (state.phase === 'ringing') {
    return (
      <RingingCard
        caller={caller}
        since={state.since}
        onDecline={decline}
        // Opened once the lead is theirs, so the page arrives with its actions
        // on rather than asking them to pick it up mid-call.
        onAccept={() => void answer().then(() => caller.id > 0 && navigate(`/leads/${caller.id}`))}
      />
    );
  }

  /**
   * Call back: take the lead, open it, and dial - the page places the call
   * once the lead is theirs (`WorkspacePage`, `callBack`). If someone else
   * picked it up first, the page opens read-only and says who.
   */
  const callBack = async () => {
    dismiss();
    await claimLead(caller.id).catch(() => undefined);
    navigate(`/leads/${caller.id}`, { state: { callBack: true } });
  };

  return (
    <div className="incoming incoming--missed" role="status" aria-label="Missed call">
      <span className="incoming__missed-icon" aria-hidden="true">
        <PhoneIcon down />
      </span>
      <div className="incoming__missed-text">
        <p className="incoming__missed-title">Missed call · {shownName(caller)}</p>
        <p className="incoming__missed-meta">Rang for {state.rangSeconds}s · texted that we will call back</p>
      </div>
      {caller.id > 0 && (
        <button type="button" className="incoming__button incoming__button--navy" onClick={() => void callBack()}>
          Call back
        </button>
      )}
      <button type="button" className="incoming__close" aria-label="Dismiss" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}

/** `Leo M.`, or the number when we hold no name. */
function shownName(caller: Caller): string {
  return shortName(caller.name) || formatPhone(caller.phone);
}

/** What the card shows beyond the name: fetched as the phone starts to ring. */
function useCallerFacts(leadId: number): { lead: LeadDetail | null; entries: TimelineEntry[] | null } {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);

  useEffect(() => {
    if (leadId < 1) return;
    let alive = true;
    // Each on its own: the card is useful with either, and with neither.
    getLead(leadId)
      .then((loaded) => alive && setLead(loaded))
      .catch(() => undefined);
    getTimeline(leadId)
      .then((loaded) => alive && setEntries(loaded))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [leadId]);

  return { lead, entries };
}

function RingingCard({
  caller,
  since,
  onAccept,
  onDecline,
}: {
  caller: Caller;
  since: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const now = useSecond();
  const me = useAuth((s) => s.user);
  const { lead, entries } = useCallerFacts(caller.id);

  const name = shownName(caller);
  const firstName = caller.name.trim().split(/\s+/)[0] || 'the lead';
  const tier = lead?.conversation?.tier ?? null;
  const context = entries && me ? callerContext(entries, me.name, now) : null;
  const mine = Boolean(lead?.claimedBy && me && lead.claimedBy.id === me.id);

  return (
    // Announced, but focus is not moved: an agent typing a text must not
    // answer a call with the space bar.
    <div className="incoming incoming--ringing" role="alert" aria-label="Incoming call">
      <header className="incoming__head">
        <span className="incoming__pulse" aria-hidden="true" />
        <span className="incoming__label">Incoming call</span>
        <span className="incoming__timer tabular" role="timer" aria-label="Ringing for">
          {callClock(Math.max(0, (now.getTime() - since) / 1000))}
        </span>
      </header>

      <div className="incoming__body">
        <div className="incoming__who">
          <span className="incoming__avatar" aria-hidden="true">
            {initials(caller.name)}
          </span>
          <div className="incoming__id">
            <p className="incoming__name">{name}</p>
            {caller.name && <p className="incoming__phone tabular">{formatPhone(caller.phone)}</p>}
          </div>
          {tier && <span className={`incoming__tier incoming__tier--${tier.toLowerCase()}`}>{tier}</span>}
        </div>

        {context && (
          <p className="incoming__context">
            <PhoneIcon />
            {context}
          </p>
        )}

        {caller.id > 0 && (
          <dl className="incoming__facts">
            <Fact label="Score">
              {lead?.conversation ? (
                <>
                  <span className="incoming__score">{lead.conversation.score}</span>
                  <span className="incoming__of"> / 100</span>
                </>
              ) : (
                '–'
              )}
            </Fact>
            <Fact label="Interest">{lead?.chips.find((chip) => chip.question === 1)?.answer ?? '–'}</Fact>
            <Fact label="Flow">{lead ? questionsLabel(lead.conversation) : '–'}</Fact>
          </dl>
        )}

        <div className="incoming__actions">
          <button type="button" className="incoming__button incoming__button--decline" onClick={onDecline}>
            <PhoneIcon down />
            Decline
          </button>
          <button type="button" className="incoming__button incoming__button--accept" onClick={onAccept}>
            <PhoneIcon />
            Accept
          </button>
        </div>

        {caller.id > 0 && (
          <p className="incoming__hint">
            {mine
              ? `Accepting opens ${firstName}’s workspace.`
              : `Accepting opens ${firstName}’s workspace and assigns the lead to you.`}
          </p>
        )}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="incoming__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Split out so the clock ticks only while there is a call to time. */
function LiveCall({ caller, call }: { caller: Caller; call: Parameters<typeof CallBar>[0]['call'] }) {
  const now = useSecond();
  return (
    <CallBar
      who={{ leadId: caller.id, name: shownName(caller), phone: caller.name ? caller.phone : '' }}
      call={call}
      now={now}
      // The lead's page polls; the note shows there on its next round.
      onNoteSaved={() => undefined}
    />
  );
}

/** A handset; `down` lays it flat, the way a phone shows "end" or "missed". */
function PhoneIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      className={down ? 'incoming__icon incoming__icon--down' : 'incoming__icon'}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}
