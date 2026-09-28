import type { LeadStatus as Status } from '../api/leads';
import { StatusIcon, type StatusIconName } from './StatusIcon';

/**
 * A lead's status on Admin > Leads: an icon and the words, the way the queue
 * shows its statuses - Jeel, 2026-09-28. The coloured pills it replaces made a
 * full page of them loud; the icon carries which status it is.
 *
 * The icons follow the lead's life: a clock while we wait on them, a chat
 * bubble while they answer, then an empty circle (Ready), a half-filled one
 * (Working) and a ticked one (Closed). Working and Needs review use the same
 * icons as the queue - `StatusIcon.tsx`.
 *
 * Tone: finished leads (Closed, Expired) step back to muted; Opted out is in
 * the danger colour, since that number can never be contacted. Everything
 * else is plain text.
 */

export const LEAD_STATUS_LABEL: Record<Status, string> = {
  awaiting_reply: 'Awaiting reply',
  answering: 'Answering',
  ready: 'Ready',
  working: 'Working',
  closed: 'Closed',
  needs_review: 'Needs review',
  opted_out: 'Opted out',
  expired: 'Expired',
};

const ICON: Record<Status, StatusIconName> = {
  awaiting_reply: 'clock',
  answering: 'chat',
  ready: 'circle',
  working: 'half',
  closed: 'check',
  needs_review: 'warning',
  opted_out: 'ban',
  expired: 'hourglass',
};

const TONE: Partial<Record<Status, 'muted' | 'danger'>> = {
  closed: 'muted',
  expired: 'muted',
  opted_out: 'danger',
};

export function LeadStatus({ status }: { status: Status }) {
  const tone = TONE[status];
  return (
    <span className={`status${tone ? ` status--${tone}` : ''}`}>
      <StatusIcon name={ICON[status]} />
      {LEAD_STATUS_LABEL[status]}
    </span>
  );
}
