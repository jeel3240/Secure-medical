import { useCallback } from 'react';
import { getConfig, type AdminConfig } from '../../api/admin';
import { usePolling } from '../../api/usePolling';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Spinner } from '../../components/Spinner';

/**
 * Admin > Configuration: what we ask, and what each answer is worth.
 *
 * DESIGN-PROMPT.md 6b and 6c, merged into one page; ADMIN.md. Phase 3 task 23.
 *
 * **Read-only, and that is a decision** - Jeel, 2026-09-23. A mistyped point
 * value silently reshuffles the queue; a broken opener costs a second segment
 * on every message or drops the STOP wording. Those changes go through a
 * numbered migration, so there is a PR, a review and a history of who changed
 * what. There is no Save here and no Recalculate, and the endpoint has no
 * writer to call.
 *
 * The page's value is that it reads the live rows every few seconds: it shows
 * what the state machine is *actually* using, not what a document says it
 * should be.
 */

/** The message keys in the order a lead meets them, with a human heading. */
const MESSAGE_HEADING: Record<string, string> = {
  question_1: 'Question 1 - the opener',
  question_2: 'Question 2',
  question_3: 'Question 3',
  message_clarify_1: 'Clarification after Q1',
  message_clarify_2: 'Clarification after Q2',
  message_clarify_3: 'Clarification after Q3',
  message_thanks: 'Thanks - sent on completion',
};

const QUESTION_HEADING: Record<number, string> = {
  1: 'Q1 · Interest',
  2: 'Q2 · Timing',
  3: 'Q3 · Preference',
};

/**
 * `scoring_rules.label` stores "Q1: Both"; under a Q1 heading the prefix is
 * repetition. Stripped here rather than in the database, because the column is
 * also read where the question is not already obvious.
 */
function choiceLabel(label: string | null, choice: string): string {
  if (!label) return choice;
  return label.replace(/^Q\d:\s*/, '');
}

export function ConfigPage() {
  const fetcher = useCallback(() => getConfig(), []);
  const { data, loading, error } = usePolling<AdminConfig>(fetcher);

  if (loading) {
    return (
      <div className="leads__loading">
        <Spinner />
      </div>
    );
  }

  if (!data) return <Banner tone="error">{error ?? 'Configuration could not be loaded.'}</Banner>;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuration</h1>
          <p className="page-subtitle">
            The live values the conversation engine is using. Read-only.
          </p>
        </div>
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}

      <Banner tone="info">
        These are changed through a migration and a pull request, not from this screen - so every
        change has a review and a history. Ask Jeel.
      </Banner>

      <div className="config">
        <section className="card config__card">
          <h2 className="config__title">Message copy</h2>
          <p className="config__note">
            Segment counts are worked out against the longest first name on file (
            <strong>{data.longestFirstName}</strong>), because a message holding{' '}
            <code>{'{first_name}'}</code> is a different length for every lead. Over{' '}
            {data.settings.segmentLimit} characters costs a second segment on every send.
          </p>

          <ul className="config__messages">
            {data.messages.map((message) => (
              <li key={message.key} className="config__message">
                <div className="config__message-head">
                  <span className="config__message-heading">
                    {MESSAGE_HEADING[message.key] ?? message.key}
                  </span>
                  <span className="config__counts tabular">
                    {message.length} chars
                    {message.personalised && ` · up to ${message.worstCaseLength}`}
                    {' · '}
                    {message.segments} segment{message.segments === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="config__body">{message.body}</p>
                {message.costsExtraSegment && (
                  <Badge tone="warning">Costs a second segment for some leads</Badge>
                )}
              </li>
            ))}
          </ul>

          <p className="config__note">
            The STOP confirmation is not listed: EZ Texting sends it itself and this app never does,
            so showing it among our copy would misrepresent what goes out.
          </p>
        </section>

        <div className="config__column">
          <section className="card config__card">
            <h2 className="config__title">Scoring</h2>
            <table className="table config__table">
              <tbody>
                {data.scoring.awards.map((award) => (
                  <tr key={award.code}>
                    <th scope="row">{award.label ?? award.code}</th>
                    <td className="right tabular">+{award.points}</td>
                  </tr>
                ))}
                {data.scoring.questions.map((question) => (
                  <tr key={question.question} className="config__question-row">
                    <th scope="row">{QUESTION_HEADING[question.question]}</th>
                    <td className="right">
                      {question.choices.map((choice) => (
                        <span key={choice.choice} className="config__choice">
                          {choiceLabel(choice.label, choice.choice)}{' '}
                          <strong className="tabular">+{choice.points}</strong>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Maximum possible</th>
                  <td className="right tabular">
                    <strong>{data.scoring.maxScore}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section className="card config__card">
            <h2 className="config__title">Tiers</h2>
            <table className="table config__table">
              <tbody>
                {data.tiers.map((tier) => (
                  <tr key={tier.name}>
                    <th scope="row">
                      <span className={`tier tier--${tier.name.toLowerCase()}`}>{tier.name}</span>
                    </th>
                    <td className="right tabular">
                      {tier.minScore} - {tier.maxScore}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Leads keep the score they were given; nothing rescores on its
                own - CLAUDE.md §10. Worth saying on the screen that shows the
                bands, or a superadmin would reasonably assume otherwise. */}
            <p className="config__note">
              Changing a rule does not rescore leads already scored. A one-off script can be run
              deliberately if it ever matters.
            </p>
          </section>

          <section className="card config__card">
            <h2 className="config__title">Settings</h2>
            <table className="table config__table">
              <tbody>
                <tr>
                  <th scope="row">Conversation expiry</th>
                  <td className="right tabular">{data.settings.expiryDays} days</td>
                </tr>
                <tr>
                  <th scope="row">Unclear replies before review</th>
                  <td className="right tabular">{data.settings.maxInvalidBeforeReview}</td>
                </tr>
                <tr>
                  <th scope="row">Segment limit</th>
                  <td className="right tabular">{data.settings.segmentLimit}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </section>
  );
}
