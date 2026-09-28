/**
 * The shared segmented control. The slide itself is a browser matter - jsdom
 * has no layout, so every option measures 0px wide - which makes this the
 * right place to pin what must hold without layout: the choice, the names, and
 * that the chosen option never loses its navy when the thumb cannot be placed.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Segmented } from './Segmented';

const TIERS = [
  { value: '', label: 'All', count: 7 },
  { value: 'HOT', label: 'Hot', count: 2 },
  { value: 'LOW', label: 'Low', count: 0 },
];

describe('Segmented', () => {
  it('marks exactly the chosen option', () => {
    render(<Segmented label="Tier" value="HOT" onChange={() => {}} options={TIERS} />);
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked.map((r) => r.textContent)).toEqual(['Hot2']);
  });

  it('reports the option clicked', () => {
    const onChange = vi.fn();
    render(<Segmented label="Tier" value="" onChange={onChange} options={TIERS} />);
    fireEvent.click(screen.getByRole('radio', { name: /Low/ }));
    expect(onChange).toHaveBeenCalledWith('LOW');
  });

  it('can choose the option whose value is empty', () => {
    // "All" is the empty string: it must still be a choice, not "nothing".
    render(<Segmented label="Tier" value="" onChange={() => {}} options={TIERS} />);
    expect(screen.getByRole('radio', { name: /All/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows a count of zero rather than hiding it', () => {
    render(<Segmented label="Tier" value="" onChange={() => {}} options={TIERS} />);
    expect(screen.getByRole('radio', { name: /Low/ }).textContent).toBe('Low0');
  });

  it('leaves out the count when there is none', () => {
    render(
      <Segmented labelledBy="role" value="agent" onChange={() => {}} options={[{ value: 'agent', label: 'Agent' }]} />
    );
    expect(screen.getByRole('radio').querySelector('.segmented__count')).toBeNull();
  });

  it('takes its name from a label, or from a visible label by id', () => {
    const { rerender } = render(<Segmented label="Tier" value="" onChange={() => {}} options={TIERS} />);
    expect(screen.getByRole('radiogroup').getAttribute('aria-label')).toBe('Tier');
    rerender(<Segmented labelledBy="add-agent-role" value="" onChange={() => {}} options={TIERS} />);
    expect(screen.getByRole('radiogroup').getAttribute('aria-labelledby')).toBe('add-agent-role');
  });

  it('keeps the navy on the chosen option when the thumb cannot be placed', () => {
    // No layout here, so there is nothing to slide: the track must not claim
    // to be ready, which is what keeps the chosen option's own navy in CSS.
    render(<Segmented label="Tier" value="HOT" onChange={() => {}} options={TIERS} />);
    const track = screen.getByRole('radiogroup');
    expect(track.classList.contains('segmented--ready')).toBe(false);
    expect(track.querySelector('.segmented__thumb')).toBeNull();
  });
});
