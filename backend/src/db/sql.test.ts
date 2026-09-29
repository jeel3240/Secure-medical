import { DEFAULT_EXPIRY_DAYS, likeLiteral, readExpiryDays } from './sql';

describe('likeLiteral', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(likeLiteral('50%_off\\now')).toBe('50\\%\\_off\\\\now');
  });

  it('leaves ordinary text alone', () => {
    expect(likeLiteral('Maria 555')).toBe('Maria 555');
  });

  it('never produces the text "${c}" - the DNC copy did, 2026-09-28', () => {
    expect(likeLiteral('%')).not.toContain('${c}');
  });
});

describe('readExpiryDays', () => {
  const settingOf = (value: unknown) => ({ query: async () => ({ rows: value === undefined ? [] : [{ value }] }) });

  it('reads the setting', async () => {
    expect(await readExpiryDays(settingOf('10'))).toBe(10);
  });

  it.each([undefined, '', 'abc', '0', '-3'])('falls back to 7 for %p', async (value) => {
    expect(await readExpiryDays(settingOf(value))).toBe(DEFAULT_EXPIRY_DAYS);
  });
});
