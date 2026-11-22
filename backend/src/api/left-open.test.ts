/** Calls left open (review H4): ended from Twilio's own record, one look at a time. */
import * as logModule from '../lib/log';
import { closeFromTwilio, closeLeftOpen } from './left-open';

describe('a call ended from Twilio\'s record', () => {
  const finishCall = jest.fn(async () => undefined);
  const settleAutomatedCall = jest.fn(async () => undefined);
  beforeEach(() => {
    finishCall.mockClear();
    settleAutomatedCall.mockClear();
  });

  it('over: ended as its own callback would have - its outcome and length, then its result', async () => {
    const close = closeFromTwilio({ callEnd: async () => ({ status: 'completed', durationSec: 95 }), finishCall, settleAutomatedCall });
    expect(await close('CA1', 7)).toBe(true);
    expect(finishCall).toHaveBeenCalledWith({ callSid: 'CA1', outcome: 'answered', durationSec: 95 });
    expect(settleAutomatedCall).toHaveBeenCalledWith(7);
  });

  it('not answered: no talk time', async () => {
    const close = closeFromTwilio({ callEnd: async () => ({ status: 'no-answer', durationSec: 30 }), finishCall, settleAutomatedCall });
    await close('CA2', 8);
    expect(finishCall).toHaveBeenCalledWith({ callSid: 'CA2', outcome: 'no_answer', durationSec: 0 });
  });

  it('still going, or Twilio cannot say: left alone', async () => {
    const close = closeFromTwilio({ callEnd: async () => null, finishCall, settleAutomatedCall });
    expect(await close('CA3', 9)).toBe(false);
    expect(finishCall).not.toHaveBeenCalled();
    expect(settleAutomatedCall).not.toHaveBeenCalled();
  });
});

describe('one look at the calls left open', () => {
  it('each asked about; one failing never stops the rest; each ended logged with its id alone', async () => {
    const logged: { level: string; event: string; fields: Record<string, unknown> }[] = [];
    const spies = (['warn', 'error'] as const).map((level) =>
      jest.spyOn(logModule.log, level).mockImplementation((event: string, fields?: Record<string, unknown>) => {
        logged.push({ level, event, fields: fields ?? {} });
      })
    );
    const closeIfOver = jest.fn(async (callSid: string) => {
      if (callSid === 'CA-broken') throw new Error('database down');
      return callSid !== 'CA-going';
    });
    const closed = await closeLeftOpen({
      callsLeftOpen: async () => [
        { callId: 1, callSid: 'CA-broken' },
        { callId: 2, callSid: 'CA-over' },
        { callId: 3, callSid: 'CA-going' },
      ],
      closeIfOver,
    });
    for (const spy of spies) spy.mockRestore();
    expect(closed).toBe(1);
    expect(closeIfOver).toHaveBeenCalledTimes(3);
    expect(logged).toEqual([
      { level: 'error', event: 'call.close_late_failed', fields: { callId: 1, err: 'database down' } },
      { level: 'warn', event: 'call.closed_late', fields: { callId: 2 } },
    ]);
  });
});
