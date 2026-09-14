import { api } from './client';
import type { PublicUser } from './types';

/** The signed-in user, or null when there is no session. */
export async function fetchMe(): Promise<PublicUser | null> {
  const { data } = await api.get<{ user: PublicUser | null }>('/auth/me');
  return data.user;
}

export async function login(email: string, password: string): Promise<PublicUser> {
  const { data } = await api.post<{ user: PublicUser }>('/auth/login', { email, password });
  return data.user;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<PublicUser> {
  const { data } = await api.post<{ user: PublicUser }>('/auth/change-password', {
    currentPassword,
    newPassword,
  });
  return data.user;
}
