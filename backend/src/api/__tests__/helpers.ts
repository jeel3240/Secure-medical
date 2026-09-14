import type { AddressInfo } from 'net';
import http from 'http';
import request from 'supertest';
import { createApp } from '../app';
import { hashPassword } from '../auth/password';
import type { Role } from '../users/types';
import { MemoryUserStore } from './memory-user-store';

export const JWT_SECRET = 'test-secret-that-is-long-enough-for-tests';

const openServers: http.Server[] = [];

/**
 * Returns the app already listening on 127.0.0.1. Handing supertest a bare app
 * makes it open a new server on a random port for every request, bound to all
 * interfaces; on a machine where another program holds that port on 127.0.0.1,
 * the request reaches that program instead and fails at random. Binding to
 * 127.0.0.1 up front means the OS never picks a port someone else has there.
 */
export async function buildApp() {
  const users = new MemoryUserStore();
  const server = http.createServer(createApp({ users, jwtSecret: JWT_SECRET, secureCookies: false }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  openServers.push(server);
  const { port } = server.address() as AddressInfo;
  return { app: `http://127.0.0.1:${port}`, users };
}

export async function closeServers(): Promise<void> {
  const servers = openServers.splice(0);
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
}

export async function seedUser(
  users: MemoryUserStore,
  opts: { email: string; name?: string; role?: Role; password: string; mustChangePassword?: boolean }
) {
  return users.create({
    email: opts.email,
    name: opts.name ?? opts.email.split('@')[0],
    role: opts.role ?? 'agent',
    passwordHash: await hashPassword(opts.password),
    mustChangePassword: opts.mustChangePassword ?? false,
  });
}

/** Signs in and returns an agent that carries the session cookie on later requests. */
export async function signIn(app: string, email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`sign-in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

/** The raw Set-Cookie value for the session, to replay an old token after it should be dead. */
export function sessionCookieFrom(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((c) => c.startsWith('sm_session='));
  if (!cookie) throw new Error('no session cookie on response');
  return cookie.split(';')[0];
}

/** The user a raw session cookie resolves to, or null when that session is dead. */
export async function whoAmI(app: string, cookie: string) {
  const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
  if (res.status !== 200) throw new Error(`unexpected /me status ${res.status}`);
  return res.body.user as { email: string } | null;
}
