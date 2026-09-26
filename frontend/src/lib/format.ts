const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** US 10-digit numbers read better grouped; anything else is shown as stored. */
export function formatPhone(phone: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

export function formatReceived(iso: string | null, now = new Date()): string {
  if (!iso) return '-';
  const date = new Date(iso);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? `Today, ${timeFormat.format(date)}` : dateTimeFormat.format(date);
}

/** Short relative time for the last-activity column. */
export function formatRelative(iso: string | null, now = new Date()): string {
  if (!iso) return '-';
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatLastLogin(iso: string | null, now = new Date()): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? `Today, ${timeFormat.format(date)}` : dateTimeFormat.format(date);
}

/**
 * A lead's age as `m:ss`, counting from when they reached us.
 *
 * The queue ticks this every second: the design brief makes age the signal for
 * how long a lead has been waiting, and a number that only moves when the data
 * refreshes would lie for up to five seconds at a time.
 *
 * Past an hour the seconds stop mattering and `1h 12m` reads better than
 * `72:30`.
 */
export function formatAge(iso: string | null, now = new Date()): string {
  if (!iso) return '-';
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * How urgent the age looks: amber past 5 minutes, red past 15 for HOT.
 *
 * DESIGN-PROMPT.md 2. The thresholds are tighter for HOT deliberately - a HOT
 * lead said "call me now", so fifteen minutes of silence is a lost sale, while
 * the same wait on a LOW lead is unremarkable.
 */
export function ageTone(iso: string | null, tier: string | null, now = new Date()): 'normal' | 'warn' | 'urgent' {
  if (!iso) return 'normal';
  const minutes = (now.getTime() - new Date(iso).getTime()) / 60000;

  if (tier === 'HOT' && minutes >= 15) return 'urgent';
  if (minutes >= 5) return 'warn';
  return 'normal';
}

/** First name plus last initial, as every lead-facing screen shows it. */
export function leadName(lead: { firstName: string | null; lastName: string | null }): string {
  const first = lead.firstName?.trim();
  const last = lead.lastName?.trim();
  if (!first && !last) return 'Unknown';
  return [first, last ? `${last[0].toUpperCase()}.` : null].filter(Boolean).join(' ');
}

/**
 * The words behind a stored answer choice.
 *
 * The state machine stores '1', '2' or '3'; `settings` holds the question copy
 * and `scoring_rules` the labels, but neither reaches the queue endpoint. These
 * are the mockup's words - DESIGN-PROMPT.md 2 - and if the client ever edits
 * the question copy these have to move with it. The Configuration page shows
 * the real copy, which is the place that would disagree first.
 */
const ANSWERS: Record<1 | 2 | 3, Record<string, string>> = {
  1: { '1': 'Supplements', '2': 'Telehealth/Rx', '3': 'Both' },
  2: { '1': 'Today', '2': 'This week', '3': 'Researching' },
  3: { '1': 'Call me now', '2': 'Text me', '3': 'Contact me later' },
};

export function answerLabel(question: 1 | 2 | 3, choice: string | null): string {
  if (!choice) return '-';
  return ANSWERS[question][choice] ?? choice;
}
