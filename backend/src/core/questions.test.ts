import { questionShort } from './questions';

describe('what the screens call a question', () => {
  it('a question on the main line by its number', () => {
    expect(questionShort({ key: 'q2', heading: 'Used telemedicine' })).toBe('Q2');
    expect(questionShort({ key: 'q12', heading: 'Anything' })).toBe('Q12');
  });

  it('a sub-question after its parent: asked second, it is not "Q4"', () => {
    expect(questionShort({ key: 'q1-a', heading: 'Offers' })).toBe('Q1-a');
    expect(questionShort({ key: 'q1-b', heading: 'Something else' })).toBe('Q1-b');
    expect(questionShort({ key: 'q10-c', heading: 'Deep in' })).toBe('Q10-c');
  });

  it('a key in neither form by its heading', () => {
    expect(questionShort({ key: 'offers', heading: 'Offers' })).toBe('Offers');
    expect(questionShort({ key: 'w3', heading: 'Weight 3' })).toBe('Weight 3');
    expect(questionShort({ key: 'q1-ab', heading: 'Too long' })).toBe('Too long');
  });
});
