import { useState } from 'react';
import type { TimelineEntry } from '../../api/workspace';
import { formatReceived } from '../../lib/format';

/**
 * The lead's notes, in the workspace's left column - Jeel, 2026-09-29.
 *
 * Notes are how one agent tells the next what the texts do not say: "wants a
 * call after 5 PM", "booked Thursday 10 AM". Until this card they were only on
 * the Lead Timeline page, one click away from the workspace, so the agent who
 * most needed them - the one about to call - never saw them, and a note saved
 * in Wrap up simply vanished from the screen.
 *
 * Newest first, with who wrote it and when. The three newest show; the rest
 * open in place, so a lead with thirty notes does not push the page down. Read
 * from the timeline the workspace already polls, so there is no second
 * request, and a note saved in Wrap up shows at once - the page refreshes the
 * timeline after Save.
 */

const SHOWN = 3;

interface NoteView {
  at: string;
  author: string | null;
  body: string;
}

/** The notes among the timeline's entries, newest first. */
export function notesNewestFirst(entries: TimelineEntry[]): NoteView[] {
  return entries
    .filter((e) => e.kind === 'note')
    .map((e) => ({ at: e.at, author: e.author, body: String(e.detail.body ?? '') }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function LeadNotes({ entries }: { entries: TimelineEntry[] | null }) {
  const [all, setAll] = useState(false);

  if (!entries) return null;
  const notes = notesNewestFirst(entries);
  const shown = all ? notes : notes.slice(0, SHOWN);

  return (
    <article className="card notes-card">
      <h2 className="card__title">
        Notes
        {notes.length > 0 && <span className="notes-card__count">{notes.length}</span>}
      </h2>

      {notes.length === 0 ? (
        <p className="notes-card__empty">No notes yet. Add one in Wrap up.</p>
      ) : (
        <ul className="notes-card__list">
          {shown.map((note) => (
            <li key={`${note.at}-${note.body}`}>
              <p className="notes-card__body">{note.body}</p>
              <p className="notes-card__meta">
                {note.author ?? 'Unknown'} · {formatReceived(note.at)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {notes.length > SHOWN && (
        <button type="button" className="notes-card__more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${notes.length}`}
        </button>
      )}
    </article>
  );
}
