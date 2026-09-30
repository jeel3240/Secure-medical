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

export function LeadAnswers({ lead }: { lead: LeadDetail }) {
  const score = lead.conversation?.score ?? 0;
  const tier = lead.conversation?.tier ?? null;

  return (
    <>
      <article className="card told-us">
        <h2 className="card__title">What {lead.firstName ?? 'the lead'} told us</h2>
        <dl className="told-us__list">
          {lead.chips.map((chip) => (
            <div key={chip.question}>
              <dt>{chip.heading}</dt>
              <dd>
                {chip.answer ?? <span className="told-us__none">-</span>}
              </dd>
            </div>
          ))}
        </dl>
      </article>

      {lead.breakdown.length > 0 && (
        <article className="card breakdown">
          <h2 className="card__title">
            Score breakdown
            <span className={`breakdown__total tabular${tier ? ` breakdown__total--${tier.toLowerCase()}` : ''}`}>
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
                style={{ flexGrow: line.points, opacity: 0.45 + i * 0.14 }}
              />
            ))}
          </div>

          <ul className="breakdown__list">
            {lead.breakdown.map((line, i) => (
              <li key={line.code}>
                <span className="breakdown__swatch" style={{ opacity: 0.45 + i * 0.14 }} />
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
