import { readAutoCalls } from './auto-calls-settings';

describe('AUTO_CALLS', () => {
  it('is on only when it says exactly "on"', () => {
    expect(readAutoCalls({ AUTO_CALLS: 'on' })).toEqual({ on: true, unknown: null });
  });

  it('is off, quietly, when unset, empty or "off"', () => {
    expect(readAutoCalls({})).toEqual({ on: false, unknown: null });
    expect(readAutoCalls({ AUTO_CALLS: '' })).toEqual({ on: false, unknown: null });
    expect(readAutoCalls({ AUTO_CALLS: 'off' })).toEqual({ on: false, unknown: null });
  });

  it.each(['true', 'yes', '1', 'ON', 'on ', ' on'])('is off, and named, when it says %j', (value) => {
    expect(readAutoCalls({ AUTO_CALLS: value })).toEqual({ on: false, unknown: value });
  });
});
