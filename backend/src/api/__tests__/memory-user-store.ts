import type { CreateUserInput, UpdateUserInput, UserRow, UserStore } from '../users/types';
import { EmailTakenError } from '../users/types';

/** In-memory UserStore with the same observable behaviour as the Postgres one. */
export class MemoryUserStore implements UserStore {
  private rows: UserRow[] = [];
  private nextId = 1;

  async findById(id: number) {
    const row = this.rows.find((u) => u.id === id);
    return row ? { ...row } : null;
  }

  async findByEmail(email: string) {
    const row = this.rows.find((u) => u.email === email);
    return row ? { ...row } : null;
  }

  async list() {
    return [...this.rows]
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id)
      .map((u) => ({ ...u }));
  }

  async create(input: CreateUserInput) {
    if (this.rows.some((u) => u.email === input.email)) throw new EmailTakenError();
    const row: UserRow = {
      id: this.nextId++,
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: input.passwordHash,
      isActive: true,
      mustChangePassword: input.mustChangePassword,
      sessionVersion: 0,
      lastLoginAt: null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return { ...row };
  }

  async update(id: number, patch: UpdateUserInput) {
    const row = this.rows.find((u) => u.id === id);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.role !== undefined) row.role = patch.role;
    if (patch.isActive !== undefined) row.isActive = patch.isActive;
    if (patch.passwordHash !== undefined) row.passwordHash = patch.passwordHash;
    if (patch.mustChangePassword !== undefined) row.mustChangePassword = patch.mustChangePassword;
    if (patch.bumpSession) row.sessionVersion += 1;
    return { ...row };
  }

  async recordLogin(id: number) {
    const row = this.rows.find((u) => u.id === id);
    if (row) row.lastLoginAt = new Date();
  }
}
