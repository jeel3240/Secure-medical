/**
 * Seri's knowledge files - A03, docs/AI-AGENT.md section 5. The real files
 * must load; and every way a file can be broken must be refused, by file and
 * field, before it reaches a call. `api/index.ts` refuses to start on the same
 * check.
 */
import answersFile from './knowledge/answers.json';
import productsFile from './knowledge/products.json';
import playbookFile from './knowledge/sales-playbook.json';
import { checkKnowledge, KnowledgeError, loadKnowledge, type KnowledgeFiles } from './knowledge';

/** Fresh copies of the real files, to break one thing in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const copies = (): { answers: any; products: any; playbook: any } =>
  JSON.parse(JSON.stringify({ answers: answersFile, products: productsFile, playbook: playbookFile }));

const problemsOf = (files: KnowledgeFiles) => {
  const result = checkKnowledge(files);
  expect(result.knowledge).toBeNull();
  return result.problems;
};

const answerAt = (files: ReturnType<typeof copies>, id: string) =>
  files.answers.answers.find((a: { id: string }) => a.id === id);

describe('the real files', () => {
  const knowledge = loadKnowledge();

  it('load, at one version', () => {
    expect(knowledge.version).toBe('approved-2026-11-11');
  });

  it('hold what the design says: 10 rules, 37 answers, 30 products, 9 objections, 3 closing questions', () => {
    expect(knowledge.rules).toHaveLength(10);
    expect(knowledge.answers).toHaveLength(37);
    expect(knowledge.products).toHaveLength(30);
    expect(knowledge.playbook.objections).toHaveLength(9);
    expect(knowledge.playbook.closing).toHaveLength(3);
  });

  it('carry no price at all - the typed products have no field for one', () => {
    const text = JSON.stringify(knowledge);
    expect(text).not.toMatch(/site_price/);
    expect(text).not.toMatch(/\d\.\d\d\b/);
    expect(text).not.toMatch(/\$/);
    expect(Object.keys(knowledge.products[0]).sort()).toEqual(['name', 'rxRequired', 'slug', 'spokenLine', 'type', 'url']);
  });

  it('give Seri only the fallback of an answer not yet confirmed - medical_web', () => {
    const open = knowledge.answers.filter((a) => a.status === 'needs_confirmation');
    expect(open.map((a) => a.id)).toEqual(['medical_web']);
    expect(open[0].spoken).toBe("We're calling on behalf of eDrugstore.");
    expect(JSON.stringify(knowledge)).not.toMatch(/Medical Web is the name on our phone line/);
  });

  it('keep the call-back number as a placeholder, filled in by the instructions', () => {
    expect(knowledge.answers.find((a) => a.id === 'customer_service')?.spoken).toBe(
      'You can call us back at this number, {callback_number}.'
    );
  });

  it('is checked once and kept', () => {
    expect(loadKnowledge()).toBe(knowledge);
  });
});

describe('a broken file is refused, by file and field', () => {
  it('a missing field, in each of the three files', () => {
    const files = copies();
    delete answerAt(files, 'price').answer;
    delete files.products.products[0].spoken_line;
    delete files.playbook.objections[2].example;
    expect(problemsOf(files)).toEqual([
      'answers.json: answers[id=price].answer is missing',
      'products.json: products[slug=amoxicillin-clavulanate-potass].spoken_line is missing',
      'sales-playbook.json: objections[2].example is missing',
    ]);
  });

  it('an empty answer, rule or question', () => {
    const files = copies();
    answerAt(files, 'offer').answer = '  ';
    files.answers.rules[3] = '';
    answerAt(files, 'scam').questions = [];
    expect(problemsOf(files)).toEqual([
      'answers.json: rules[3] is empty',
      'answers.json: answers[id=offer].answer is empty',
      'answers.json: answers[id=scam].questions is missing or empty',
    ]);
  });

  it('versions that differ', () => {
    const files = copies();
    files.products.version = 'approved-2026-11-12';
    expect(problemsOf(files)).toEqual([
      'the three files must share one version: answers.json approved-2026-11-11, products.json approved-2026-11-12, sales-playbook.json approved-2026-11-11',
    ]);
  });

  it('a missing version', () => {
    const files = copies();
    delete files.playbook.version;
    expect(problemsOf(files)).toEqual(['sales-playbook.json: version is missing']);
  });

  it('an answer not yet confirmed with no fallback to say', () => {
    const files = copies();
    delete answerAt(files, 'medical_web').fallback_answer;
    expect(problemsOf(files)).toEqual(['answers.json: answers[id=medical_web].fallback_answer is missing']);
  });

  it('a placeholder nothing fills in - in an answer, a product, the playbook', () => {
    const files = copies();
    answerAt(files, 'price').answer = 'It is {price} today.';
    files.products.products[1].spoken_line = 'Ask {agent_name} about it.';
    files.playbook.closing[0].ask = 'Shall I connect you, {first_name}?';
    expect(problemsOf(files)).toEqual([
      'answers.json: answers[id=price].answer holds {price}, which nothing fills in',
      'products.json: products[slug=sulfamethoxazole-trimethoprim].spoken_line holds {agent_name}, which nothing fills in',
      'sales-playbook.json: closing[0].ask holds {first_name}, which nothing fills in',
    ]);
  });

  it('an id or a product used twice', () => {
    const files = copies();
    answerAt(files, 'scam').id = 'price';
    files.products.products[2].slug = files.products.products[0].slug;
    expect(problemsOf(files)).toEqual([
      'answers.json: answers[id=price].id repeats "price"',
      'products.json: products[slug=amoxicillin-clavulanate-potass].slug repeats "amoxicillin-clavulanate-potass"',
    ]);
  });

  it('a value that is not one of the allowed ones', () => {
    const files = copies();
    answerAt(files, 'offer').status = 'draft';
    files.products.products[0].rx_required = 'maybe';
    files.products.products[0].type = 'vitamin';
    files.products.products[0].url = 'http://www.edrugstore.com/';
    expect(problemsOf(files)).toEqual([
      'answers.json: answers[id=offer].status must be one of approved, needs_confirmation',
      'products.json: products[slug=amoxicillin-clavulanate-potass].url must start with https://',
      'products.json: products[slug=amoxicillin-clavulanate-potass].type must be one of antibiotic, antiviral, kit, test_kit',
      'products.json: products[slug=amoxicillin-clavulanate-potass].rx_required must be one of yes, no',
    ]);
  });

  it('a whole file missing, or not an object', () => {
    const files = copies();
    expect(problemsOf({ ...files, products: undefined })).toEqual(['products.json: is not an object']);
    expect(problemsOf({ ...files, answers: [] })).toEqual(['answers.json: is not an object']);
    expect(problemsOf({ ...files, playbook: { ...files.playbook, objections: [] } })).toEqual([
      'sales-playbook.json: objections is missing or empty',
    ]);
  });

  it('the error names every problem', () => {
    const err = new KnowledgeError(['answers.json: answers[id=price].answer is missing', 'products.json: version is missing']);
    expect(err.message).toBe(
      "Seri's knowledge files are broken: answers.json: answers[id=price].answer is missing; products.json: version is missing"
    );
  });
});
