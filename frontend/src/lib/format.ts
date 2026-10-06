const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * "3:45 PM" - the one clock format. Five screens each built their own
 * identical formatter until 2026-09-28.
 */
export function formatTime(date: Date): string {
  return timeFormat.format(date);
}

/** "Sep 28, 3:45 PM". */
export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

/**
 * The value an `<input type="datetime-local">` wants: local time with no zone,
 * `2026-09-28T15:45` - not an ISO string, which is UTC. Wrap up and My
 * Callbacks each had their own copy until 2026-09-28.
 */
export function toLocalInput(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

/** First name plus last initial, as every lead-facing screen shows it. */
export function leadName(lead: { firstName: string | null; lastName: string | null }): string {
  const first = lead.firstName?.trim();
  const last = lead.lastName?.trim();
  if (!first && !last) return 'Unknown';
  return [first, last ? `${last[0].toUpperCase()}.` : null].filter(Boolean).join(' ');
}

/** The same, from a full name as stored: `Leo Martinez` -> `Leo M.`. Empty stays empty. */
export function shortName(full: string): string {
  const [first, ...rest] = full.trim().split(/\s+/);
  return leadName({ firstName: first || null, lastName: rest[rest.length - 1] ?? null }).replace(/^Unknown$/, '');
}
