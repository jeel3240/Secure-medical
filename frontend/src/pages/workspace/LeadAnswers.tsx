import type { LeadDetail } from '../../api/workspace';

/**
 * The workspace's left column: what the lead told us, and how that became
 * their score. Split out of WorkspacePage.tsx, 2026-09-28.
 *
 * The answers are plain text - Jeel, 2026-09-29. They were three pills in three
 * colours (indigo, amber, green), which said nothing the words did not and read
 * as decoration.
 */

/**
 * The breakdown in the mockup's words. The API's labels are the bare answer -
 * "Both", "Today" - which reads fine on a chip but is ambiguous in a list of
 * points: "Today +30" does not say what was asked. Q3 stays bare because its
 * answers already say what they are ("Call me now").
 */
function breakdownLabel(code: string, label: string): string {
  if (code === 'responded') return 'Responded to SMS';
  if (code === 'completed') return 'Completed flow';
  if (code.startsWith('q1_')) return `Interest: ${label}`;
  if (code.startsWith('q2_')) return `Timing: ${label}`;
  return label;
}

/**
 * The shade for line `i` of `n`: light blue for the first, the brand navy for
 * the last - Jeel, 2026-09-29. It was the Hot red at rising opacity, which read
 * as an alarm on every lead and ignored the app's colours.
 */
export function breakdownShade(i: number, n: number): string {
  const navy = n <= 1 ? 100 : Math.round(20 + (80 * i) / (n - 1));
  return `color-mix(in oklch, var(--color-primary) ${navy}%, var(--breakdown-light))`;
}

export function LeadAnswers({ lead }: { lead: LeadDetail }) {
  const score = lead.conversation?.score ?? 0;

  return (
    <>
      <article className="card told-us">
        <h2 className="card__title">What {lead.firstName ?? 'the lead'} told us</h2>
        <dl className="told-us__list">
          {/* One per question answered - as many as the lead's flow asked. */}
          {lead.chips.length === 0 && <p className="told-us__none">Nothing yet</p>}
          {lead.chips.map((chip) => (
            <div key={chip.key}>
              <dt>{chip.heading}</dt>
              <dd>{chip.answer}</dd>
            </div>
          ))}
        </dl>
      </article>

      {lead.breakdown.length > 0 && (
        <article className="card breakdown">
          <h2 className="card__title">
            Score breakdown
            <span className="breakdown__total tabular">
              {score}
            </span>
          </h2>

          {/* One segment per line, sized by what it contributed - the shape
              of the score at a glance, before reading the numbers. */}
          <div
            className="breakdown__bar"
            role="img"
            aria-label={`Score ${score} of 100`}
          >
            {lead.breakdown.map((line, i) => (
              <span
                key={line.code}
                className="breakdown__seg"
                style={{ flexGrow: line.points, background: breakdownShade(i, lead.breakdown.length) }}
              />
            ))}
          </div>

          <ul className="breakdown__list">
            {lead.breakdown.map((line, i) => (
              <li key={line.code}>
                <span className="breakdown__swatch" style={{ background: breakdownShade(i, lead.breakdown.length) }} />
                <span className="breakdown__label">{breakdownLabel(line.code, line.label)}</span>
                <span className="breakdown__points tabular">+{line.points}</span>
              </li>
            ))}
          </ul>
        </article>
      )}
    </>
  );
}
