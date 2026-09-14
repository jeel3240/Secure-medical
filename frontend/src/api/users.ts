import { api } from './client';
import type { PublicUser, Role } from './types';

export async function listUsers(): Promise<PublicUser[]> {
  const { data } = await api.get<{ users: PublicUser[] }>('/users');
  return data.users;
}

export async function createUser(input: {
  name: string;
  email: string;
  role: Role;
}): Promise<{ user: PublicUser; temporaryPassword: string }> {
  const { data } = await api.post<{ user: PublicUser; temporaryPassword: string }>('/users', input);
  return data;
}

export async function updateUser(
  id: number,
  patch: { name?: string; role?: Role; isActive?: boolean }
): Promise<PublicUser> {
  const { data } = await api.patch<{ user: PublicUser }>(`/users/${id}`, patch);
  return data.user;
}

export async function resetUserPassword(id: number): Promise<{ user: PublicUser; temporaryPassword: string }> {
  const { data } = await api.post<{ user: PublicUser; temporaryPassword: string }>(`/users/${id}/reset-password`);
  return data;
}
