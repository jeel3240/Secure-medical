import { NAME_FALLBACK, renderMessage, SEGMENT_LIMIT } from './messages';

const OPENER =
  'Secure Medical: Hi {first_name}, you asked about health & wellness options. ' +
  'What interests you? Reply 1 Supplements, 2 Telehealth/Rx, 3 Both. Reply STOP to opt out.';

describe('renderMessage', () => {
  it('substitutes the first name', () => {
    expect(renderMessage(OPENER, 'Jordan').text).toContain('Hi Jordan,');
  });

  it.each([[null], [undefined], [''], ['   ']])('falls back to "there" for %j', (name) => {
    const { text, nameDropped } = renderMessage(OPENER, name as string | null);
    expect(text).toContain(`Hi ${NAME_FALLBACK},`);
    expect(nameDropped).toBe(false);
  });

  it('trims surrounding whitespace in the name', () => {
    expect(renderMessage(OPENER, '  Maya \n').text).toContain('Hi Maya,');
  });

  it('keeps the mockup opener to one segment with a typical name', () => {
    const { text } = renderMessage(OPENER, 'Jordan');
    expect(text.length).toBe(158);
    expect(text.length).toBeLessThanOrEqual(SEGMENT_LIMIT);
  });

  it('drops a long name rather than paying for a second segment', () => {
    const { text, nameDropped } = renderMessage(OPENER, 'Christopher');
    expect(nameDropped).toBe(true);
    expect(text).toContain(`Hi ${NAME_FALLBACK},`);
    expect(text.length).toBeLessThanOrEqual(SEGMENT_LIMIT);
  });

  it('leaves a template without a placeholder alone', () => {
    expect(renderMessage('Reply 1 Today, 2 This week.', 'Jordan').text).toBe('Reply 1 Today, 2 This week.');
  });

  it('replaces every occurrence', () => {
    expect(renderMessage('{first_name}, hi {first_name}', 'Ana').text).toBe('Ana, hi Ana');
  });

  it('honours a lower limit, for Standard delivery at 130', () => {
    const { text, nameDropped } = renderMessage(OPENER, 'Jordan', 130);
    expect(nameDropped).toBe(true);
    expect(text).toContain(`Hi ${NAME_FALLBACK},`);
  });

  it('accepts a message that is over the limit on its own, with no name to drop', () => {
    const long = 'x'.repeat(200) + ' {first_name}';
    expect(renderMessage(long, 'Jo').text.endsWith(' Jo')).toBe(true);
  });
});
