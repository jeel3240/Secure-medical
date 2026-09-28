/**
 * A tier as signal bars and a word: three bars for Hot, two for Warm, one for
 * Low. Jeel's queue mockup, 2026-09-28 - the coloured HOT / WARM / LOW badges
 * were the loudest thing in every row, and the bars rank the tiers at a glance
 * without colour. The word stays, so the tier never depends on reading an
 * icon.
 */

const FILLED: Record<string, number> = { HOT: 3, WARM: 2, LOW: 1 };
const LABEL: Record<string, string> = { HOT: 'Hot', WARM: 'Warm', LOW: 'Low' };

export function TierSignal({ tier }: { tier: string | null }) {
  if (!tier) return <span className="tier-signal tier-signal--none">-</span>;
  const filled = FILLED[tier] ?? 0;

  return (
    <span className="tier-signal">
      <svg className="tier-signal__bars" width="13" height="12" viewBox="0 0 13 12" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={i * 5}
            y={8 - i * 4}
            width="3"
            height={4 + i * 4}
            rx="0.75"
            className={i < filled ? 'tier-signal__bar tier-signal__bar--on' : 'tier-signal__bar'}
          />
        ))}
      </svg>
      {LABEL[tier] ?? tier}
    </span>
  );
}
