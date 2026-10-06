import { questionShort } from './questions';

describe('what the screens call a question', () => {
  it('a numbered question by its number', () => {
    expect(questionShort({ key: 'q2', heading: 'Used telemedicine' })).toBe('Q2');
    expect(questionShort({ key: 'q12', heading: 'Anything' })).toBe('Q12');
  });

  it('one off the main line by its heading - "Q4" would claim three answers it never had', () => {
    expect(questionShort({ key: 'offers', heading: 'Offers' })).toBe('Offers');
    expect(questionShort({ key: 'w3', heading: 'Weight 3' })).toBe('Weight 3');
  });
});
