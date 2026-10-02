/**
 * A call's transcript, under the call - TWILIO.md, "Recordings and transcripts".
 *
 * Closed by default: the call line already says what happened, and a whole
 * conversation opened under every call would bury the thread. Shared by the
 * workspace conversation and the Lead Timeline.
 */

interface Line {
  speaker: 'agent' | 'lead';
  text: string;
}

/** What the server attaches to a call that was recorded. */
interface Transcript {
  status: 'pending' | 'queued' | 'completed' | 'failed';
  lines: Line[];
}

function transcriptOf(detail: Record<string, unknown>): Transcript | null {
  const t = detail.transcript as Transcript | undefined;
  return t && typeof t.status === 'string' ? t : null;
}

export function CallTranscript({
  detail,
  agentName,
  leadName,
}: {
  detail: Record<string, unknown>;
  /** Who to call each side; "Agent" and "Lead" when not known. */
  agentName?: string | null;
  leadName?: string | null;
}) {
  const transcript = transcriptOf(detail);
  if (!transcript) return null;

  if (transcript.status === 'failed') {
    return <p className="transcript__state">Transcript not available</p>;
  }
  if (transcript.status !== 'completed') {
    return <p className="transcript__state">Transcript in progress</p>;
  }
  if (transcript.lines.length === 0) {
    return <p className="transcript__state">Nothing was said</p>;
  }

  const name = (speaker: Line['speaker']) =>
    speaker === 'agent' ? agentName || 'Agent' : leadName || 'Lead';

  return (
    <details className="transcript">
      <summary>Transcript</summary>
      <ol className="transcript__lines">
        {transcript.lines.map((line, i) => (
          <li key={i} className={`transcript__line transcript__line--${line.speaker}`}>
            <span className="transcript__speaker">{name(line.speaker)}</span>
            {line.text}
          </li>
        ))}
      </ol>
    </details>
  );
}
