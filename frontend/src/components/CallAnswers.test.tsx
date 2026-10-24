/**
 * What the lead said on the robot's call - T21, AUTO-CALLS.md. Each answer in
 * words, and the fold it sits in.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { answerText, CallAnswers, type CallAnswer } from './CallAnswers';

const answer = (a: Partial<CallAnswer>): CallAnswer => ({
  question: 'Q1',
  attempt: 1,
  heard: null,
  keys: null,
  result: 'choice',
  choice: 'Yes',
  ...a,
});

describe('one answer in words', () => {
  it('said: what was heard, and what it was taken to mean', () => {
    expect(answerText(answer({ heard: 'yeah sure' }))).toBe('Q1 · "yeah sure" → Yes');
  });

  it('pressed: the key, which wins over anything heard', () => {
    expect(answerText(answer({ question: 'Q2', keys: '2', heard: 'um', choice: 'No' }))).toBe('Q2 · pressed 2 → No');
  });

  it('asked again: says so', () => {
    expect(answerText(answer({ attempt: 2, keys: '1' }))).toBe('Q1, asked again · pressed 1 → Yes');
  });

  it('not understood, or a stop', () => {
    expect(answerText(answer({ heard: 'what is this', result: 'unclear', choice: null }))).toBe('Q1 · "what is this" → not understood');
    expect(answerText(answer({ keys: '5', result: 'unclear', choice: null }))).toBe('Q1 · pressed 5 → not understood');
    expect(answerText(answer({ heard: 'stop calling me', result: 'opt_out', choice: null }))).toBe('Q1 · "stop calling me" → stop');
    expect(answerText(answer({ keys: '9', result: 'opt_out', choice: null }))).toBe('Q1 · pressed 9 → stop');
  });

  it('silence: nothing said', () => {
    expect(answerText(answer({ result: 'silence', choice: null }))).toBe('Q1 · nothing said');
    expect(answerText(answer({ attempt: 2, result: 'silence', choice: null }))).toBe('Q1, asked again · nothing said');
  });
});

describe('the fold', () => {
  it('closed until opened, one line per answer, in order', () => {
    const { container } = render(
      <CallAnswers detail={{ answers: [answer({ heard: 'what', result: 'unclear', choice: null }), answer({ attempt: 2, keys: '1' })] }} />
    );
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(screen.getByText('Answers')).toBeDefined();
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Q1 · "what" → not understood',
      'Q1, asked again · pressed 1 → Yes',
    ]);
  });

  it('nothing for a call with no answers - any other call, or one nobody spoke on', () => {
    expect(render(<CallAnswers detail={{ answers: [] }} />).container.innerHTML).toBe('');
    expect(render(<CallAnswers detail={{ outcome: 'answered' }} />).container.innerHTML).toBe('');
  });
});
