import { Fragment, useCallback, type ReactNode } from 'react';
import { getConfig, type AdminConfig } from '../../api/admin';
import { usePolling } from '../../api/usePolling';
import { Banner } from '../../components/Banner';
import { LiveStatus } from '../../components/LiveStatus';
import { Spinner } from '../../components/Spinner';
import { TierSignal } from '../../components/TierSignal';
import { clockText, daysText, minutesText } from '../../lib/call-settings';
import { formatPhone } from '../../lib/format';

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
 *
 * **The automated call - T24, AUTO-CALLS.md.** A Call script card under
 * Messages, every line the robot says in the order a lead can hear them, in
 * the Messages card's own rows; and a Calls card under Settings, with the
 * values the robot reads - whether it is on, when it calls, how long things
 * ring. The link it texts is under Messages, counted like the other texts.
 */

/**
 * What a placeholder stands for, as the page shows it: `{first_name}` in a
 * text, `{callback_number}` in the voicemail - the calling number itself when
 * calling is set up - and `{place}` in the hold line.
 */
export function placeholderText(name: string, callbackNumber: string | null): string {
  if (name === 'first_name') return 'first name';
  if (name === 'callback_number') return callbackNumber ? formatPhone(callbackNumber) : 'our number';
  if (name === 'place') return '2, 3…';
  return name.replace(/_/g, ' ');
}

/** Each placeholder marked where it sits, so the part filled in is visible. */
function withPlaceholders(body: string, callbackNumber: string | null = null): ReactNode {
  return body.split(/(\{[a-z_]+\})/).map((part, i) => {
    const name = /^\{([a-z_]+)\}$/.exec(part)?.[1];
    return name ? (
      <mark key={i} className="config-msg__var">
        {placeholderText(name, callbackNumber)}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}

/** What picks a line, under it: "Key 1, or: yes, yeah, yep". */
export function pickedBy(line: { press: string | null; words: string[] }): string | null {
  if (!line.press) return null;
  return line.words.length > 0 ? `Key ${line.press}, or: ${line.words.join(', ')}` : `Key ${line.press}`;
}

/** "Responded at all" and "Completed all questions", as plain sentences. */
const AWARD_LABEL: Record<string, string> = {
  responded: 'Replied at all',
  completed: 'Answered the questions',
};

/**
 * A question as the Messages card names it - "Q2", "Q1-a" - joined to what it
 * asks, so "After Q2" there and this card's points can be matched: "Q2 · Used
 * telemedicine", "Q1-a · Offers". The name comes from the server, which has
 * the one rule for it; a question it could only call by its heading is not
 * said twice.
 */
export function questionTitle(question: { short: string; heading: string }): string {
  return question.short === question.heading ? question.heading : `${question.short} · ${question.heading}`;
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
            The live values the texts and the automated calls are using. Read-only - changes go
            through a pull request.
          </p>
        </div>
        <LiveStatus updatedAt={updatedAt} paused={Boolean(error)} />
      </div>

      {error && <Banner tone="warning">{error} Showing the last update.</Banner>}

      <div className="config">
        <div className="config__column">
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

          <section className="card table-card">
            <header className="card-head">
              <h2 className="card-head__title">Call script</h2>
              <span className="card-head__meta">
                {data.callScript ? `${data.callScript.name} · as a lead hears it` : 'No call script is active'}
              </span>
            </header>

            {data.callScript && (
              <>
                <ol className="config-msgs">
                  {data.callScript.lines.map((line) => {
                    const picked = pickedBy(line);
                    return (
                      <li key={line.key} className="config-msg">
                        <div className="config-msg__label">
                          <span className="config-msg__name">{line.name}</span>
                          <span className="config-msg__when">{line.when}</span>
                        </div>
                        <div>
                          <p className="config-msg__body">
                            {withPlaceholders(line.body, data.callSettings.callbackNumber)}
                          </p>
                          {picked && <p className="config-msg__meta">{picked}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <p className="card-note">
                  Spoken in the voice {data.callScript.voice}. The link it texts is under Messages.
                </p>
              </>
            )}
          </section>
        </div>

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

          <CallSettingsCard settings={data.callSettings} />
        </div>
      </div>
    </section>
  );
}

/** The automated call's settings, as the robot reads them - T24. */
function CallSettingsCard({ settings }: { settings: AdminConfig['callSettings'] }) {
  const rows: [string, string][] = [
    ['Automated calls', settings.on ? 'On' : 'Off'],
    ['Calls between', `${clockText(settings.startMinute)} - ${clockText(settings.endMinute)}`],
    ['Time zone', settings.timeZone],
    ['Days', daysText(settings.days)],
    ['First call', `${minutesText(settings.waitMinutes)} after the first text`],
    ['A yes rings people for', `${settings.ringSeconds} seconds`],
    ['A lead on hold rings for', `${settings.offerRingSeconds} seconds`],
    ['On hold at most', minutesText(settings.holdMaxMinutes)],
    ['Spoken answers trusted from', `${settings.minConfidence} confidence`],
    ['Call-back number', settings.callbackNumber ? formatPhone(settings.callbackNumber) : '-'],
  ];
  return (
    <section className="card table-card">
      <header className="card-head">
        <h2 className="card-head__title">Calls</h2>
        <span className="card-head__meta">The automated call</span>
      </header>
      <dl className="kv">
        {rows.map(([label, value]) => (
          <div key={label} className="kv__row">
            <dt>{label}</dt>
            <dd className="tabular">{value}</dd>
          </div>
        ))}
      </dl>
      {/* AUTO_CALLS is an environment variable, set on the server - not a setting a migration changes. */}
      {!settings.on && <p className="card-note">Off until AUTO_CALLS is on and calling is set up.</p>}
    </section>
  );
}
