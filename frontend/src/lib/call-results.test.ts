/**
 * The robot's call in words - one wording for the timeline and Admin > Leads
 * (T21, T23).
 */
import { describe, expect, it } from 'vitest';
import { CALL_FILTERS, CALL_RESULT_WORDS, leadCallText } from './call-results';

describe('the Call column on Admin > Leads - T23', () => {
  it.each([
    ['transferred', 'Said yes · taken'],
    ['transfer_missed', 'Said yes · nobody took it'],
    ['link_sent', 'Link sent'],
    ['not_interested', 'Not interested'],
    ['voicemail_left', 'Voicemail left'],
    ['no_response', 'No response'],
    ['hung_up', 'Hung up'],
    ['unanswered', 'No answer'],
    ['opted_out', 'Opted out'],
    ['calling', 'Calling now'],
    ['unknown', 'No result'],
  ])('%s reads "%s"', (call, words) => {
    expect(leadCallText(call)).toBe(words);
  });

  it('says a result it does not know in plain words, never the raw value', () => {
    expect(leadCallText('some_new_result')).toBe('Some new result');
  });

  it('uses the timeline\'s words, capitalised - one wording for both screens', () => {
    for (const [result, words] of Object.entries(CALL_RESULT_WORDS)) {
      expect(leadCallText(result).toLowerCase()).toBe(words);
    }
  });

  it('filters on every value the column shows, plus all and not called, each named as the column names it', () => {
    expect(CALL_FILTERS[0]).toEqual({ key: '', label: 'All calls' });
    expect(CALL_FILTERS[1]).toEqual({ key: 'none', label: 'Not called' });
    for (const result of [...Object.keys(CALL_RESULT_WORDS), 'calling', 'unknown']) {
      expect(CALL_FILTERS).toContainEqual({ key: result, label: leadCallText(result) });
    }
    expect(CALL_FILTERS).toHaveLength(13);
  });
});
