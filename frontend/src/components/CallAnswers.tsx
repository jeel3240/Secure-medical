/**
 * What the lead said on the robot's call, under the call - T21,
 * docs/AUTO-CALLS.md. Each question, what was heard or pressed, and what it
 * was taken to mean: `Q1 · "yeah sure" → Yes`.
 *
 * Closed by default, like the transcript beside it (`CallTranscript`), whose
 * look it shares: the call's line already says how it ended. Shared by the
 * workspace conversation and the Lead Timeline. Nothing for any other call.
 */

/** One answer, as the server sends it on a robot call (`db/timeline.ts`). */
export interface CallAnswer {
  /** "Q1" - named as every screen names a question. */
  question: string;
  /** 1, or 2 when it was asked again. */
  attempt: number;
  heard: string | null;
  /** A key pressed - it wins over anything heard. */
  keys: string | null;
  /** `choice`, `unclear`, `silence` or `opt_out`. */
  result: string;
  /** The choice it matched - "Yes". */
  choice: string | null;
}

const MEANT: Record<string, string> = { unclear: 'not understood', opt_out: 'stop' };

/** One answer in words: `Q1 · "yeah sure" → Yes`, `Q2, asked again · pressed 2 → No`. */
export function answerText(answer: CallAnswer): string {
  const asked = answer.attempt === 2 ? `${answer.question}, asked again` : answer.question;
  const said = answer.keys ? `pressed ${answer.keys}` : answer.heard ? `"${answer.heard}"` : null;
  if (!said) return `${asked} · nothing said`;
  const meant = answer.result === 'choice' ? (answer.choice ?? 'answered') : (MEANT[answer.result] ?? answer.result);
  return `${asked} · ${said} → ${meant}`;
}

export function CallAnswers({ detail }: { detail: Record<string, unknown> }) {
  const answers = Array.isArray(detail.answers) ? (detail.answers as CallAnswer[]) : [];
  if (answers.length === 0) return null;
  return (
    <details className="transcript">
      <summary>Answers</summary>
      <ol className="transcript__lines">
        {answers.map((answer, i) => (
          <li key={i} className="transcript__line">
            {answerText(answer)}
          </li>
        ))}
      </ol>
    </details>
  );
}
