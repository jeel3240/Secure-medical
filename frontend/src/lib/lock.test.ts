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
import { lockHolder, rowAction } from './lock';

const lead = (tag: QueueTag | null): QueueLead => ({
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
  q1Label: 'Both',
  q2Label: 'Today',
  q3Label: 'Call me now',
  conversationStatus: 'completed',
  tag,
});

const user = (id: number, name: string, role: PublicUser['role'] = 'agent'): PublicUser => ({
  id,
  email: `${name.toLowerCase()}@example.com`,
  name,
  role,
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
});

const MAYA = user(11, 'Maya Chen');
const RAE = user(12, 'Rae Whitfield');
const BOSS = user(13, 'Boss Admin', 'superadmin');

describe('a lead nobody holds', () => {
  it.each<[string, QueueTag | null]>([
    ['no status', null],
    ['inbound_reply', { kind: 'inbound_reply' }],
    ['needs_review', { kind: 'needs_review' }],
  ])('is open to anyone (%s)', (_, tag) => {
    expect(lockHolder(lead(tag), MAYA)).toBeNull();
  });
});

describe('a lead another agent holds', () => {
  const held = lead({ kind: 'working', agentId: RAE.id, agentName: 'Rae Whitfield' });

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

describe('two agents with the same name', () => {
  it('are told apart by id - one sees Resume, the other Locked', () => {
    // Matched by name until 2026-09-28: each saw the other's lead as their own.
    const samA = user(21, 'Sam Okonjo');
    const samB = user(22, 'Sam Okonjo');
    const held = lead({ kind: 'working', agentId: samA.id, agentName: 'Sam Okonjo' });

    expect(rowAction(held, samA)).toBe('resume');
    expect(rowAction(held, samB)).toBe('locked');
  });
});

describe('a working tag with no holder id', () => {
  it('is treated as unlocked', () => {
    // The queue endpoint only omits the name when the holder is deactivated,
    // and db/claims.ts lets anyone take over such a lead. Muting the row would
    // strand it: nobody could ever open it.
    expect(lockHolder(lead({ kind: 'working' }), MAYA)).toBeNull();
  });
});

describe('what the row action offers', () => {
  const agent = { id: 2, name: 'karm', role: 'agent' } as PublicUser;
  const boss = { id: 1, name: 'Jeel Kakadiya', role: 'superadmin' } as PublicUser;

  it('offers Pick on a lead nobody holds', () => {
    expect(rowAction(lead(null), agent)).toBe('pick');
  });

  it('offers Resume on your own lead, not Pick', () => {
    // You cannot "pick" something you already hold.
    expect(rowAction(lead({ kind: 'working', agentId: 2, agentName: 'karm' }), agent)).toBe('resume');
  });

  it('offers Resume to a superadmin on their own lead', () => {
    // The mine check runs before the superadmin one, or a superadmin would be
    // sent to the read-only page for a lead they are working.
    expect(rowAction(lead({ kind: 'working', agentId: 1, agentName: 'Jeel Kakadiya' }), boss)).toBe('resume');
  });

  it('offers a superadmin View, never Pick, on someone else`s lead', () => {
    // The server refuses that claim with 409, so Pick would always fail.
    expect(rowAction(lead({ kind: 'working', agentId: 2, agentName: 'karm' }), boss)).toBe('view');
  });

  it('offers an agent nothing on someone else`s lead', () => {
    expect(rowAction(lead({ kind: 'working', agentId: 1, agentName: 'Jeel Kakadiya' }), agent)).toBe('locked');
  });

  it('offers Pick when the tag names no holder', () => {
    expect(rowAction(lead({ kind: 'working' }), agent)).toBe('pick');
  });

  it('locks a signed-out view of a held lead', () => {
    expect(rowAction(lead({ kind: 'working', agentId: 2, agentName: 'karm' }), null)).toBe('locked');
  });
});
