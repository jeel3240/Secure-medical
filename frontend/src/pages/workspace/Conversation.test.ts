import { describe, expect, it } from 'vitest';
import type { AnswerChip, TimelineEntry } from '../../api/workspace';
import { labelReplies } from './Conversation';

const inbound = (body: string): TimelineEntry =>
  ({ kind: 'inbound', at: '2026-09-28T10:00:00Z', author: null, detail: { body } }) as TimelineEntry;
const sent = (body: string): TimelineEntry =>
  ({ kind: 'sms', at: '2026-09-28T10:00:00Z', author: null, detail: { body } }) as TimelineEntry;

const chip = (question: number, choice: string, answer: string): AnswerChip => ({
  question,
  key: `q${question}`,
  heading: ['', 'Interest', 'Timing', 'Prefers'][question],
  choice,
  answer,
});

const COMPLETED = [chip(1, '3', 'Both'), chip(2, '1', 'Today'), chip(3, '1', 'Call me now')];

describe('labelling a reply with the answer it was recorded as', () => {
  it('labels each digit with its own question, in order', () => {
    const entries = [sent('Q1'), inbound('3'), sent('Q2'), inbound('1'), sent('Q3'), inbound('1')];
    const labels = labelReplies(entries, COMPLETED);

    expect(labels.get(1)).toBe('Both');
    expect(labels.get(3)).toBe('Today');
    expect(labels.get(5)).toBe('Call me now');
  });

  it('does not let an unclear reply shift every later label by one', () => {
    // The trap that counting inbound messages falls into: "who?" would be taken
    // as the answer to Q1, and every label after it would be wrong.
    const entries = [sent('Q1'), inbound('who is this?'), sent('clarify'), inbound('3'), sent('Q2'), inbound('1')];
    const labels = labelReplies(entries, COMPLETED);

    expect(labels.has(1)).toBe(false);
    expect(labels.get(3)).toBe('Both');
    expect(labels.get(5)).toBe('Today');
  });

  it('leaves a worded answer as plain text rather than guessing', () => {
    // "today please" was accepted as Q2, but it is not the digit on record, so
    // nothing proves which answer it was - better unlabelled than wrong.
    // Two answered; the third is not there - a chip exists only once a question is answered.
    const chips = [chip(1, '3', 'Both'), chip(2, '1', 'Today')];
    const entries = [inbound('3'), inbound('today please')];
    const labels = labelReplies(entries, chips);

    expect(labels.get(0)).toBe('Both');
    expect(labels.has(1)).toBe(false);
  });

  it('labels nothing for a lead who answered nothing', () => {
    const chips: AnswerChip[] = [];
    expect(labelReplies([inbound('1'), inbound('2')], chips).size).toBe(0);
  });

  it('does not label a digit that does not match the recorded choice', () => {
    // A lead who sent "2" that the flow did not accept, then "3": only the 3 is theirs.
    const labels = labelReplies([inbound('2'), inbound('3')], COMPLETED);
    expect(labels.has(0)).toBe(false);
    expect(labels.get(1)).toBe('Both');
  });

  it('stops once every answer has been placed', () => {
    const entries = [inbound('3'), inbound('1'), inbound('1'), inbound('1')];
    const labels = labelReplies(entries, COMPLETED);
    expect(labels.size).toBe(3);
    expect(labels.has(3)).toBe(false);
  });

  it('forgives whitespace around the digit', () => {
    expect(labelReplies([inbound(' 3 ')], COMPLETED).get(0)).toBe('Both');
  });
});
