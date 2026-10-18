import { api } from './client';

/**
 * Browser calling - Phase 4, TWILIO.md.
 *
 * The config says whether calling is set up on this server and which number
 * leads will see; the token is the browser's short-lived permission to place
 * calls as the signed-in agent. Which lead a call may reach is decided by the
 * server when the call starts, not here. And whether this browser can take a
 * call now - T9, AUTO-CALLS.md "Who is free".
 */

export interface CallConfig {
  enabled: boolean;
  /** The number leads see, E.164. Null when calling is off. */
  callerId: string | null;
}

let config: Promise<CallConfig> | null = null;

/**
 * Asked once per page load: it only changes when the server is reconfigured.
 * A failed request is not remembered, so the next lead opened asks again.
 */
export function getCallConfig(): Promise<CallConfig> {
  config ??= api
    .get<CallConfig>('/calls/config')
    .then((res) => res.data)
    .catch((err) => {
      config = null;
      throw err;
    });
  return config;
}

export async function getCallToken(): Promise<string> {
  const { data } = await api.post<{ token: string }>('/calls/token');
  return data.token;
}

/**
 * Tells the server whether this browser can take a call now. It holds for two
 * minutes. Given up after ten seconds: these are sent one after another, and
 * one stuck request must not hold back the rest.
 */
export async function postRingable(available: boolean): Promise<void> {
  await api.post('/calls/ringable', { available }, { timeout: 10_000 });
}
