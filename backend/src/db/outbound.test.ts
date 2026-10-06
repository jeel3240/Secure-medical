import { sendAndRecord } from './outbound';

/** A fake database that records every statement and can fail one on demand. */
function fakeDb(failWhen?: RegExp) {
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text.replace(/\s+/g, ' ').trim());
      if (failWhen?.test(text)) throw new Error('database unavailable');
      return { rows: [{ id: 41 }] };
    },
  };
}

const blocked = () => Object.assign(new Error('blocked'), { name: 'BlockedNumberError' });

describe('sendAndRecord', () => {
  it('writes the row as sending before it sends, then records the EZ Texting id', async () => {
    const db = fakeDb();
    const order: string[] = [];
    const result = await sendAndRecord(db, {
      leadId: 7,
      body: 'Q1',
      send: async () => {
        order.push(`send after ${db.sql.length} statement(s)`);
        return { id: 'ezt-1' };
      },
    });

    expect(result).toEqual({ sent: true, eztMessageId: 'ezt-1' });
    expect(db.sql[0]).toMatch(/INSERT INTO messages .* 'sending'/);
    expect(order).toEqual(['send after 1 statement(s)']);
    expect(db.sql[1]).toMatch(/SET ezt_message_id = \$2, delivery_status = NULL/);
  });

  it('sends nothing when the database cannot take the row', async () => {
    const db = fakeDb(/INSERT/);
    const send = jest.fn();

    await expect(sendAndRecord(db, { leadId: 7, body: 'Q1', send })).rejects.toThrow('database unavailable');
    expect(send).not.toHaveBeenCalled();
  });

  it('marks the row failed when EZ Texting refuses', async () => {
    const db = fakeDb();
    const result = await sendAndRecord(db, {
      leadId: 7,
      body: 'Q1',
      send: async () => {
        throw new Error('503');
      },
    });

    expect(result).toMatchObject({ sent: false, blocked: false });
    expect(db.sql[1]).toMatch(/SET delivery_status = 'failed'/);
  });

  it('leaves the row as sending when the send timed out - it may have gone, so it is neither failed nor retried', async () => {
    const db = fakeDb();
    const result = await sendAndRecord(db, {
      leadId: 7,
      body: 'Q1',
      send: async () => {
        throw Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
      },
    });

    expect(result).toMatchObject({ sent: false, blocked: false, unconfirmed: true });
    // Only the insert: nothing marks it failed, which is what the opener retry reads.
    expect(db.sql).toHaveLength(1);
  });

  it('a connection that could not be made is a plain failure: nothing left', async () => {
    const db = fakeDb();
    const result = await sendAndRecord(db, {
      leadId: 7,
      body: 'Q1',
      send: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
    });

    expect(result).toMatchObject({ sent: false, blocked: false });
    expect(result).not.toHaveProperty('unconfirmed');
    expect(db.sql[1]).toMatch(/SET delivery_status = 'failed'/);
  });

  it('removes the row for a blocked number - that send was never attempted', async () => {
    const db = fakeDb();
    const result = await sendAndRecord(db, {
      leadId: 7,
      body: 'Q1',
      send: async () => {
        throw blocked();
      },
    });

    expect(result).toMatchObject({ sent: false, blocked: true });
    expect(db.sql[1]).toMatch(/DELETE FROM messages/);
  });

  it('reports a delivered text as sent even when recording its id fails - so it is never sent again', async () => {
    // The review finding, 2026-09-28: this case used to become a "failed"
    // row, and the opener retry then sent the same text a second time.
    const db = fakeDb(/SET ezt_message_id/);
    const result = await sendAndRecord(db, { leadId: 7, body: 'Q1', send: async () => ({ id: 'ezt-9' }) });

    expect(result).toEqual({ sent: true, eztMessageId: 'ezt-9' });
    expect(db.sql.some((s) => /'failed'/.test(s))).toBe(false);
  });
});
