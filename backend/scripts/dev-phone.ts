/**
 * A phone number typed on the command line, as the database holds it - for the
 * dev scripts. `6025550123`, `16025550123` and `+1 (602) 555-0123` are all
 * `+16025550123`; anything else is null. US numbers only, as every lead is.
 */
export function phoneFromArg(raw: string | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
