import type { CreateUserInput, Role, UpdateUserInput, UserRow, UserStore } from '../api/users/types';
import { EmailTakenError } from '../api/users/types';
import { pool } from './pool';

const COLUMNS = `id, email, name, role, password_hash, is_active, must_change_password,
  session_version, last_login_at, created_at`;

const UNIQUE_VIOLATION = '23505';

interface DbUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  session_version: number;
  last_login_at: Date | null;
  created_at: Date;
}

function toUserRow(row: DbUser): UserRow {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    passwordHash: row.password_hash,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    sessionVersion: row.session_version,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export const pgUserStore: UserStore = {
  async findById(id) {
    const { rows } = await pool.query<DbUser>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ? toUserRow(rows[0]) : null;
  },

  async findByEmail(email) {
    const { rows } = await pool.query<DbUser>(`SELECT ${COLUMNS} FROM users WHERE email = $1`, [email]);
    return rows[0] ? toUserRow(rows[0]) : null;
  },

  async list() {
    const { rows } = await pool.query<DbUser>(`SELECT ${COLUMNS} FROM users ORDER BY lower(name), id`);
    return rows.map(toUserRow);
  },

  async create(input: CreateUserInput) {
    try {
      const { rows } = await pool.query<DbUser>(
        `INSERT INTO users (email, name, role, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLUMNS}`,
        [input.email, input.name, input.role, input.passwordHash, input.mustChangePassword]
      );
      return toUserRow(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new EmailTakenError();
      }
      throw err;
    }
  },

  async update(id, patch: UpdateUserInput) {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (patch.name !== undefined) add('name', patch.name);
    if (patch.role !== undefined) add('role', patch.role);
    if (patch.isActive !== undefined) add('is_active', patch.isActive);
    if (patch.passwordHash !== undefined) add('password_hash', patch.passwordHash);
    if (patch.mustChangePassword !== undefined) add('must_change_password', patch.mustChangePassword);
    if (patch.bumpSession) sets.push('session_version = session_version + 1');

    values.push(id);
    const { rows } = await pool.query<DbUser>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${COLUMNS}`,
      values
    );
    return rows[0] ? toUserRow(rows[0]) : null;
  },

  async recordLogin(id) {
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
  },
};
