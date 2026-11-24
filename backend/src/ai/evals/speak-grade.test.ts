/**
 * How a speak reply is marked - A29. No OpenAI here: `npm run ai:eval:speak`
 * asks it.
 */
import { says } from './speak-grade';

describe('says', () => {
  it('whole words, any case', () => {
    expect(says('I’m an AI assistant.', 'ai')).toBe(true);
    expect(says('I said it again.', 'ai')).toBe(false);
    expect(says('Call 911 now.', '911')).toBe(true);
    expect(says('That is $39.', '$')).toBe(true);
    expect(says('I DON’T KNOW', "i don't know")).toBe(true);
  });
});
