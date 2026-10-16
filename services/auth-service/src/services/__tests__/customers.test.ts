import { phoneKey } from '../customers.js';

describe('customers', () => {
  it.each([
    ['01712-345678', '01712345678'],
    ['+880 1712 345678', '01712345678'],
    ['8801712345678', '01712345678'],
    ['1712345678', '01712345678'],
    ['(212) 555-0100', '2125550100'],
  ])('one customer per phone number: %p → %p', (typed, key) => {
    expect(phoneKey(typed)).toBe(key);
  });
});
