/**
 * What the screens call a question when they say where a lead is: "On Q2",
 * "Stopped at Offers". Pure.
 *
 * A numbered question is "Q2". One off the main line - the antibiotics flow's
 * offers question, asked only of a lead who said No - goes by its heading: its
 * position is 4, and "Q4" would say the lead had answered three questions when
 * they answered one. One rule, here, for every screen: Configuration, the lead
 * card, Admin > Leads. docs/FLOWS.md.
 */
export function questionShort(question: { key: string; heading: string }): string {
  return /^q\d+$/.test(question.key) ? question.key.toUpperCase() : question.heading;
}
