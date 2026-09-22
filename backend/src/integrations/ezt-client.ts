import axios from 'axios';
import { config } from '../config';

const BASE_URL = 'https://a.eztexting.com/v1';

// size outside this set returns 400.
const ALLOWED_PAGE_SIZES = [10, 20, 50, 100, 200];

export interface EztGroup {
  id: string;
  name: string;
  note?: string;
  contactsCount?: number;
}

// Shape confirmed against the live account. Note there is no contact id
// field: phoneNumber is the only stable identity.
export interface EztContact {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  note?: string;
  source: string;
  values?: Record<string, unknown>;
  createdAt: string;
  optOut: boolean;
  groups: EztGroup[];
}

export interface EztPage<T> {
  content: T[];
  last: boolean;
  totalElements: number;
  totalPages: number;
}

export interface ListContactsOptions {
  groupName: string;
  page?: number;
  size?: number;
  source?: string;
}

export interface SendMessageResult {
  id: string;
}

const authHeader = () => {
  const raw = `${config.ezt.username}:${config.ezt.password}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
};

export async function listContacts(options: ListContactsOptions): Promise<EztPage<EztContact>> {
  const { groupName, page = 0, size = 50, source = 'API' } = options;

  if (!groupName) {
    throw new Error('listContacts requires a groupName: the account holds real contacts');
  }
  if (!ALLOWED_PAGE_SIZES.includes(size)) {
    throw new Error(`size must be one of ${ALLOWED_PAGE_SIZES.join(', ')}`);
  }

  const response = await axios.get<EztPage<EztContact>>(`${BASE_URL}/contacts`, {
    headers: { Authorization: authHeader() },
    params: {
      'filters[groupName][like]': groupName,
      'filters[source][eq]': source,
      sort: 'createdAt,desc',
      size,
      page,
    },
  });

  return response.data;
}

/**
 * groupName is matched with `like`, so a query for "weightloss" also returns
 * contacts whose only match is "weightloss - sent". Membership has to be
 * confirmed on the response.
 */
export function isInGroup(contact: EztContact, groupName: string): boolean {
  return (contact.groups ?? []).some((group) => group.name === groupName);
}

export function findGroup(contact: EztContact, groupName: string): EztGroup | undefined {
  return (contact.groups ?? []).find((group) => group.name === groupName);
}

/** Contacts come back without a leading +; E.164 for our own storage. */
export function toE164(phoneNumber: string): string {
  return `+${phoneNumber}`;
}

/** ...and the send endpoint wants them without the + again. */
export function fromE164(phone: string): string {
  return phone.replace(/^\+/, '');
}

/** Raised when a send is refused because the number has opted out. */
export class BlockedNumberError extends Error {
  constructor(readonly phones: string[]) {
    super(`Refusing to send: ${phones.join(', ')} on dnc_list`);
    this.name = 'BlockedNumberError';
  }
}

/**
 * The opted-out numbers among these, read immediately before sending.
 *
 * Loaded lazily so this module stays importable without a database - it is
 * otherwise a pure HTTP client, and its own tests do not need one.
 */
async function blockedAmong(phones: string[]): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pool } = require('../db/pool') as typeof import('../db/pool');

  // dnc_list stores E.164. Callers pass E.164 today, but comparing a bare
  // number against a stored +1... would silently match nothing and send to a
  // blocked phone, so normalise rather than trust.
  const normalised = phones.map((p) => (p.startsWith('+') ? p : toE164(p)));

  const { rows } = await pool.query(
    'SELECT phone FROM dnc_list WHERE phone = ANY($1::text[])',
    [normalised]
  );
  return rows.map((r: { phone: string }) => r.phone);
}

/**
 * Sends one SMS to one or more numbers.
 *
 * Checks `dnc_list` immediately before sending, every time. The poller checks
 * before it creates a lead, which covers the opener, but that leaves the gap
 * this closes: a reply in the flow going out minutes after a STOP that arrived
 * from somewhere else. Honouring an opt-out is a compliance obligation, not a
 * nicety, so the check lives here where no caller can forget it.
 */
export async function sendMessage(toPhones: string[], message: string): Promise<SendMessageResult> {
  if (!config.ezt.sendGroup) {
    throw new Error(
      'Refusing to send: EZT_SEND_GROUP is not set. This account is live, and ' +
        'CLAUDE.md allows sending only to a dev-test group of our own phones.'
    );
  }

  const blocked = await blockedAmong(toPhones);
  if (blocked.length > 0) {
    throw new BlockedNumberError(blocked);
  }

  const response = await axios.post<SendMessageResult>(
    `${BASE_URL}/messages`,
    { toNumbers: toPhones.map(fromE164), message },
    { headers: { Authorization: authHeader() } }
  );

  return response.data;
}
