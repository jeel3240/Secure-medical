import type { ReactNode } from 'react';

/**
 * The status icons, one set for every screen that shows a status - the queue
 * (`QueueStatus.tsx`), Admin > Leads (`LeadStatus.tsx`), the DNC list and
 * Admin > Agents. Shared so the
 * same state never has two pictures: Working is the half-filled circle and
 * Needs review the triangle wherever they appear.
 *
 * Outline icons on a 24-unit grid, stroked in the text colour like LockIcon, so
 * a muted row greys its icon with its words. Jeel's queue mockup, 2026-09-28.
 */

export type StatusIconName =
  | 'clock'
  | 'chat'
  | 'circle'
  | 'half'
  | 'check'
  | 'inbound'
  | 'missed'
  | 'phone'
  | 'tag'
  | 'warning'
  | 'ban'
  | 'hourglass'
  | 'shield'
  | 'person';

const PATHS: Record<StatusIconName, ReactNode> = {
  // Waiting on them.
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  // A conversation under way.
  chat: (
    <>
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </>
  ),
  // Not started: an empty circle, the first of circle, half, check.
  circle: <circle cx="12" cy="12" r="9" />,
  // Started, not finished.
  half: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </>
  ),
  // Finished.
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </>
  ),
  // A text has come to us: a message box with an arrow pointing in.
  inbound: (
    <>
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4z" />
      <path d="M16 10H8M11 7l-3 3 3 3" />
    </>
  ),
  // A call came in and nobody took it: a handset with an arrow that turned away.
  missed: (
    <>
      <path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" />
      <path d="M15 4l2.5 2.5L20 4M17.5 6.5V3" />
    </>
  ),
  // They asked for a call: the handset, with no arrow.
  phone: (
    <path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" />
  ),
  // Offers only: a price tag.
  tag: (
    <>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <path d="M7.5 7.5h.01" />
    </>
  ),
  // A person has to look.
  warning: (
    <>
      <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  // Blocked.
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  // An account that can manage the others - Admin > Agents.
  shield: <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />,
  // An agent's account.
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  // Ran out of time.
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
    </>
  ),
};

export function StatusIcon({ name }: { name: StatusIconName }) {
  return (
    <svg
      className={`status__icon status__icon--${name}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
