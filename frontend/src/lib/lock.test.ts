/**
 * The one-agent lock as the queue applies it.
 *
 * Tested because getting it backwards is invisible until two agents are on one
 * lead, or until an agent cannot reopen their own. The server enforces the real
 * rule; this decides which rows look clickable.
 */
import { describe, expect, it } from 'vitest';
import type { QueueLead, QueueTag } from '../api/leads';
import type { PublicUser } from '../api/types';
import { lockHolder } from './lock';

const lead = (tag: QueueTag): QueueLead => ({
  id: 1,
  phone: '+15551000001',
  firstName: 'Jordan',
  lastName: 'Miller',
  source: 'CORE-G-27',
  receivedAt: '2026-09-26T12:00:00.000Z',
  score: 100,
  tier: 'HOT',
  q1: '3',
  q2: '1',
  q3: '1',
  conversationStatus: 'completed',
  tag,
});

const user = (name: string, role: PublicUser['role'] = 'agent'): PublicUser => ({
  id: 1,
  email: `${name.toLowerCase()}@example.com`,
  name,
  role,
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
});

const MAYA = user('Maya Chen');
const RAE = user('Rae Whitfield');
const BOSS = user('Boss Admin', 'superadmin');

describe('a lead nobody holds', () => {
  it.each<QueueTag>([
    { kind: 'new' },
    { kind: 'inbound_reply' },
    { kind: 'needs_review' },
    { kind: 'stalled', step: 2 },
    { kind: 'attempted', attempts: 1 },
    { kind: 'callback', callbackAt: '2026-09-26T15:00:00.000Z' },
  ])('is open to anyone ($kind)', (tag) => {
    expect(lockHolder(lead(tag), MAYA)).toBeNull();
  });
});

describe('a lead another agent holds', () => {
  const held = lead({ kind: 'in_progress', agentName: 'Rae Whitfield' });

  it('is locked, and names the holder', () => {
    expect(lockHolder(held, MAYA)).toBe('Rae Whitfield');
  });

  it('is locked for a signed-out view too', () => {
    // Defaulting to unlocked would invite a click that the server refuses.
    expect(lockHolder(held, null)).toBe('Rae Whitfield');
  });

  it('is not locked for the agent who holds it', () => {
    // Reopening your own claim is the normal way back into a lead.
    expect(lockHolder(held, RAE)).toBeNull();
  });

  it('is not locked for a superadmin', () => {
    // They can force-release, and need to see what an agent is stuck on.
    expect(lockHolder(held, BOSS)).toBeNull();
  });
});

describe('an in_progress tag with no name', () => {
  it('is treated as unlocked', () => {
    // The queue endpoint only omits the name when the holder is deactivated,
    // and db/claims.ts lets anyone take over such a lead. Muting the row would
    // strand it: nobody could ever open it.
    expect(lockHolder(lead({ kind: 'in_progress' }), MAYA)).toBeNull();
  });
});
