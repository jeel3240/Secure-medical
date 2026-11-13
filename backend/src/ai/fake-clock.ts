/**
 * A clock moved by hand, for tests only: the relay's limits (A12) run when a
 * test says so, not after real seconds.
 */

import type { Timers } from './conversation';

export class FakeClock implements Timers {
  private at = 0;
  private next = 1;
  private pending = new Map<number, { at: number; run: () => void }>();

  set(run: () => void, ms: number): number {
    const id = this.next++;
    this.pending.set(id, { at: this.at + ms, run });
    return id;
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** Moves on `ms`, running each timer that falls due, in order. */
  advance(ms: number): void {
    const to = this.at + ms;
    for (;;) {
      let due: [number, { at: number; run: () => void }] | null = null;
      for (const entry of this.pending) if (entry[1].at <= to && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      this.pending.delete(due[0]);
      this.at = due[1].at;
      due[1].run();
    }
    this.at = to;
  }

  /** How many timers are set. */
  get waiting(): number {
    return this.pending.size;
  }
}
