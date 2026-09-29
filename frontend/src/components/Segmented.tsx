import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A segmented control: a row of mutually exclusive options on a grey track,
 * the chosen one marked in the header's navy.
 *
 * One component for every use - the queue's tier switcher and the Add agent
 * drawer's role choice wrote the same markup by hand - so the control has one
 * look and one behaviour.
 *
 * **The navy slides.** Jeel, 2026-09-28: switching jumped from one option to
 * the next. The navy is now a thumb behind the options that glides to the
 * chosen one. Its position is measured, not guessed, because options differ in
 * width and a count ("All 7" becoming "All 12") changes them.
 *
 * Three things keep that honest:
 * - The thumb is placed before the first paint and only animates after that,
 *   so a page never opens with it sweeping in from the left.
 * - Until it has been placed, the chosen option carries the navy itself, so
 *   white text is never left on the grey track.
 * - People who ask their system for reduced motion get the switch without the
 *   slide - `styles/controls.css`, `prefers-reduced-motion`.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown beside the label, a step quieter - the queue's tier counts. */
  count?: number;
}

interface Thumb {
  left: number;
  width: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name when there is no visible label. */
  label?: string;
  /** The id of a visible label, when there is one. */
  labelledBy?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const [animate, setAnimate] = useState(false);

  // What the thumb's position depends on: the choice, and anything that can
  // change an option's width. Options arrive as a fresh array every render, so
  // they cannot be the dependency themselves.
  const layoutKey = options.map((o) => `${o.value}:${o.label}:${o.count ?? ''}`).join('|');

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;

    const place = () => {
      const chosen = el.querySelector<HTMLElement>('[aria-checked="true"]');
      const next = chosen && chosen.offsetWidth > 0 ? { left: chosen.offsetLeft, width: chosen.offsetWidth } : null;
      // Same position, same object: React skips the render, so re-measuring
      // on every change cannot loop.
      setThumb((prev) =>
        prev && next && prev.left === next.left && prev.width === next.width ? prev : next
      );
    };

    place();

    // A resize can move an option without the choice changing - the counts
    // update every five seconds. Not every environment has ResizeObserver.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, layoutKey]);

  // Turn the slide on only after the first placement has been painted.
  useEffect(() => {
    if (!thumb || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [thumb, animate]);

  return (
    <div
      ref={track}
      className={`segmented${thumb ? ' segmented--ready' : ''}`}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
    >
      {thumb && (
        <span
          className={`segmented__thumb${animate ? ' segmented__thumb--animate' : ''}`}
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
          aria-hidden="true"
        />
      )}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="segmented__option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span className="segmented__count tabular">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
