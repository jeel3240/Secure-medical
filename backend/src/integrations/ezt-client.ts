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

export async function sendMessage(toPhones: string[], message: string): Promise<SendMessageResult> {
  if (!config.ezt.sendGroup) {
    throw new Error(
      'Refusing to send: EZT_SEND_GROUP is not set. This account is live, and ' +
        'CLAUDE.md allows sending only to a dev-test group of our own phones.'
    );
  }

  const response = await axios.post<SendMessageResult>(
    `${BASE_URL}/messages`,
    { toNumbers: toPhones.map(fromE164), message },
    { headers: { Authorization: authHeader() } }
  );

  return response.data;
}
