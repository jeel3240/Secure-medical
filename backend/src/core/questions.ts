/**
 * What the screens call a question when they say where a lead is: "On Q2",
 * "Stopped at Q1-a". Pure.
 *
 * **A question is named by its key, and a sub-question after its parent** -
 * Jeel, 2026-10-06:
 *
 *   q1, q2, q3     the main line           -> "Q1", "Q2", "Q3"
 *   q1-a, q1-b     asked after question 1  -> "Q1-a", "Q1-b"
 *
 * The antibiotics flow's offers question is `q1-a`: it is asked only of a lead
 * who said No to question 1. By position it read "Q4", as if that lead had
 * answered three questions when they had answered one.
 *
 * A key in neither form falls back to the question's heading, so a flow with
 * its own naming still shows something true. One rule, here, for every
 * screen: Configuration, the lead card, Admin > Leads. docs/FLOWS.md.
 */
const NAMED_BY_KEY = /^q\d+(-[a-z])?$/;

export function questionShort(question: { key: string; heading: string }): string {
  return NAMED_BY_KEY.test(question.key) ? `Q${question.key.slice(1)}` : question.heading;
}
