import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateTimeField, monthGrid, timeSlots } from './DateTimeField';

describe('the date and time field', () => {
  it('lays a month out in six Sunday-first weeks', () => {
    const grid = monthGrid(2026, 8); // September 2026 starts on a Tuesday
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(0);
    expect(grid[0].getDate()).toBe(30); // Aug 30
    expect(grid[2].getDate()).toBe(1); // Sep 1
  });

  it('offers every quarter hour', () => {
    const slots = timeSlots();
    expect(slots).toHaveLength(96);
    expect(slots.slice(0, 2)).toEqual(['00:00', '00:15']);
    expect(slots[slots.length - 1]).toBe('23:45');
  });

  it('shows the label until something is picked, then the date and time', () => {
    const { container, rerender } = render(<DateTimeField value="" onChange={() => {}} label="New time" />);
    expect(container.textContent).toContain('New time');
    rerender(<DateTimeField value="2031-03-04T15:30" onChange={() => {}} label="New time" />);
    expect(container.querySelector('.dt-field')?.textContent).toMatch(/Mar 4, 3:30\sPM/);
  });

  it('picking a day keeps the chosen time', () => {
    const onChange = vi.fn();
    const { getByRole, getAllByRole } = render(
      <DateTimeField value="2031-03-04T15:30" onChange={onChange} label="New time" />
    );
    // Once a date is chosen the label carries it, for screen readers.
    fireEvent.click(getByRole('button', { name: /^New time: Mar 4, 3:30\sPM$/ }));
    const day10 = getAllByRole('button').find((b) => b.textContent === '10' && !b.className.includes('--other'))!;
    fireEvent.click(day10);
    expect(onChange).toHaveBeenLastCalledWith('2031-03-10T15:30');
  });

  it('does not offer a day before today, nor a month before this one', () => {
    const { getByRole, getAllByRole } = render(<DateTimeField value="" onChange={() => {}} label="New time" />);
    fireEvent.click(getByRole('button', { name: 'New time' }));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const days = getAllByRole('button').filter((b) => b.className.includes('dt-panel__day')) as HTMLButtonElement[];
    // On the 1st, yesterday is one of last month's days leading the grid.
    const sameMonth = yesterday.getMonth() === new Date().getMonth();
    const shown = days.find(
      (b) => b.textContent === String(yesterday.getDate()) && b.className.includes('--other') !== sameMonth
    );
    expect(shown?.disabled).toBe(true);
    expect((getByRole('button', { name: 'Previous month' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears, as a chip, back to its label', () => {
    const onChange = vi.fn();
    const { getByRole, container } = render(
      <DateTimeField variant="chip" value="2031-03-04T15:30" onChange={onChange} label="Other…" />
    );
    expect(container.querySelector('.chip-button--on')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: /^Other…: / }));
    fireEvent.click(getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('closes on Escape', () => {
    const { getByRole, queryByRole } = render(<DateTimeField value="" onChange={() => {}} label="New time" />);
    fireEvent.click(getByRole('button', { name: 'New time' }));
    expect(queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
  });
});
