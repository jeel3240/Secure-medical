import { useParams } from 'react-router-dom';
import { WorkspacePage } from './WorkspacePage';

/**
 * A lead's page, made afresh for each lead. Going from one lead's page to
 * another - Accept, or a missed call's Call back - kept the same page, and
 * with it the first lead's after-call note box: the note was saved to the
 * second lead (review H6, 2026-11-22). Keyed by the lead, every bit of the
 * page's own state starts over.
 */
export function LeadWorkspaceRoute() {
  const { id } = useParams();
  return <WorkspacePage key={id} />;
}
