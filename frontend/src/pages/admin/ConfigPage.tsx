import { Fragment, useCallback, type ReactNode } from 'react';
import { getConfig, type AdminConfig } from '../../api/admin';
import { usePolling } from '../../api/usePolling';
import { Banner } from '../../components/Banner';
import { LiveStatus } from '../../components/LiveStatus';
import { Spinner } from '../../components/Spinner';
import { TierSignal } from '../../components/TierSignal';

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
 *
 * **Laid out like the other admin pages - Jeel, 2026-09-28:** "too messy". The
 * blue box, the copy in a code font on grey, the upper-case labels, the
 * coloured tier pills and three paragraphs of notes are gone. Four cards with
 * plain rows; each card's one caveat is a quiet line at its foot; the tiers use
 * the queue's signal bars.
 */

/** `{first_name}` marked where it sits, so the personalised part is visible. */
function withPlaceholders(body: string): ReactNode {
  return body.split(/(\{first_name\})/).map((part, i) =>
    part === '{first_name}' ? (
      <mark key={i} className="config-msg__var">
        first name
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

/** "Responded at all" and "Completed all questions", as plain sentences. */
const AWARD_LABEL: Record<string, string> = {
  responded: 'Replied at all',
  completed: 'Answered the questions',
};

/**
 * A question as the Messages card names it - "Q2", or its heading for one off
 * the main line - joined to what it asks, so "After Q2" there and this card's
 * points can be matched: "Q2 · Used telemedicine", "Offers".
 */
export function questionTitle(question: { key: string; heading: string }): string {
  return /^q\d+$/.test(question.key) ? `${question.key.toUpperCase()} · ${question.heading}` : question.heading;
}

export function ConfigPage() {
  const fetcher = useCallback(() => getConfig(), []);
  const { data, loading, error, updatedAt } = usePolling<AdminConfig>(fetcher);

  if (loading) {
    return (
      <div className="loading-block">
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
            The live values the conversation engine is using. Read-only - changes go through a pull
            request.
          </p>
        </div>
        <LiveStatus updatedAt={updatedAt} paused={Boolean(error)} />
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}

      <div className="config">
        <section className="card table-card">
          <header className="card-head">
            <h2 className="card-head__title">Messages</h2>
            <span className="card-head__meta">
              {data.flow ? `${data.flow.name} · as a lead receives them` : 'No flow is active'}
            </span>
          </header>

          <ol className="config-msgs">
            {data.messages.map((message) => {
              return (
                <li key={message.key} className="config-msg">
                  <div className="config-msg__label">
                    <span className="config-msg__name">{message.name}</span>
                    <span className="config-msg__when">{message.when}</span>
                  </div>
                  <div>
                    <p className="config-msg__body">{withPlaceholders(message.body)}</p>
                    <p className={`config-msg__meta${message.costsExtraSegment ? ' config-msg__meta--warn' : ''}`}>
                      <span className="tabular">
                        {message.personalised ? `Up to ${message.worstCaseLength}` : message.length} characters
                      </span>
                      {' · '}
                      {message.segments} segment{message.segments === 1 ? '' : 's'}
                      {message.costsExtraSegment && ' - billed as more than one'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          <p className="card-note">
            {data.longestNameIsFallback
              ? `Lengths are counted with "${data.longestFirstName}", the word used when a lead has no first name - no name on file is longer.`
              : `Lengths are counted with the longest first name on file, "${data.longestFirstName}".`}{' '}
            Over {data.settings.segmentLimit} characters costs a second segment. The STOP confirmation
            is sent by EZ Texting, not by us, so it is not listed.
          </p>
        </section>

        <div className="config__column">
          <section className="card table-card">
            <header className="card-head">
              <h2 className="card-head__title">Scoring</h2>
              <span className="card-head__meta">Points per answer</span>
            </header>
            <dl className="kv">
              {data.scoring.awards.map((award) => (
                <div key={award.code} className="kv__row">
                  <dt>{AWARD_LABEL[award.code] ?? award.label ?? award.code}</dt>
                  <dd className="tabular">+{award.points}</dd>
                </div>
              ))}
              {data.scoring.questions.map((question) => (
                <div key={question.question} className="kv__group">
                  <dt className="kv__group-title">{questionTitle(question)}</dt>
                  {question.choices.map((choice) => (
                    <div key={choice.choice} className="kv__row kv__row--sub">
                      <dt>{choice.label ?? choice.choice}</dt>
                      <dd className="tabular">+{choice.points}</dd>
                    </div>
                  ))}
                </div>
              ))}
              <div className="kv__row kv__row--total">
                <dt>Maximum</dt>
                <dd className="tabular">{data.scoring.maxScore}</dd>
              </div>
            </dl>
          </section>

          <section className="card table-card">
            <header className="card-head">
              <h2 className="card-head__title">Tiers</h2>
              <span className="card-head__meta">Score bands</span>
            </header>
            <dl className="kv">
              {data.tiers.map((tier) => (
                <div key={tier.name} className="kv__row">
                  <dt>
                    <TierSignal tier={tier.name} />
                  </dt>
                  <dd className="tabular">
                    {tier.minScore} - {tier.maxScore}
                  </dd>
                </div>
              ))}
            </dl>
            {/* Leads keep the score they were given; nothing rescores on its
                own - CLAUDE.md §10. */}
            <p className="card-note">A rule change does not rescore leads already scored.</p>
          </section>

          <section className="card table-card">
            <header className="card-head">
              <h2 className="card-head__title">Settings</h2>
            </header>
            <dl className="kv">
              <div className="kv__row">
                <dt>Conversation expires after</dt>
                <dd className="tabular">{data.settings.expiryDays} days</dd>
              </div>
              <div className="kv__row">
                {/* The setting counts clarifications, not unclear replies: at 1,
                    the first unclear reply is clarified and the second goes to
                    review. "Unclear replies before review: 1" read as the
                    opposite. STATE-MACHINE.md, rule 4. */}
                <dt>Clarifications before review</dt>
                <dd className="tabular">{data.settings.maxInvalidBeforeReview}</dd>
              </div>
              <div className="kv__row">
                <dt>Segment limit</dt>
                <dd className="tabular">{data.settings.segmentLimit} characters</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </section>
  );
}
