/**
 * Admin > Configuration's words: a question's title, and - T24 - the call
 * script's placeholders and what picks a line.
 */
import { describe, expect, it } from 'vitest';
import { pickedBy, placeholderText, questionTitle } from './ConfigPage';

describe('a question\'s title', () => {
  it('joins the name to what it asks, and never says one twice', () => {
    expect(questionTitle({ short: 'Q1-a', heading: 'Offers' })).toBe('Q1-a · Offers');
    expect(questionTitle({ short: 'Offers', heading: 'Offers' })).toBe('Offers');
  });
});

describe('the call script - T24', () => {
  it('shows what each placeholder stands for', () => {
    expect(placeholderText('first_name', null)).toBe('first name');
    // The voicemail's number is the calling number itself, once calling is set up.
    expect(placeholderText('callback_number', '+14805308582')).toBe('(480) 530-8582');
    expect(placeholderText('callback_number', null)).toBe('our number');
    expect(placeholderText('place', null)).toBe('2, 3…');
    expect(placeholderText('something_new', null)).toBe('something new');
  });

  it('says what picks a line: its key, and the words heard for it', () => {
    expect(pickedBy({ press: '1', words: ['yes', 'yeah'] })).toBe('Key 1, or: yes, yeah');
    expect(pickedBy({ press: '9', words: [] })).toBe('Key 9');
    expect(pickedBy({ press: null, words: [] })).toBeNull();
  });
});
