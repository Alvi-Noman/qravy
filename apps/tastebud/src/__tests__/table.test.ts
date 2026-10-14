// The guest's table stays on every dine-in link, at their branch — also when the phone can't remember it.
type T = typeof import('../utils/table');
let getTable: T['getTable'], setTable: T['setTable'], withTable: T['withTable'];

const go = (url: string) => window.history.replaceState(null, '', url);

beforeEach(() => {
  jest.resetModules(); // a fresh visit: nothing remembered in memory either
  ({ getTable, setTable, withTable } = require('../utils/table') as T);
  localStorage.clear();
  go('/');
});

describe('withTable', () => {
  it('adds the remembered table (and its QR key) to a dine-in link at the same branch', () => {
    go('/t/burger-house/gulshan/dine-in/menu?table=12&k=abcd1234');
    setTable('burger-house', '12', 'abcd1234');
    expect(withTable('/t/burger-house/gulshan/dine-in', 'burger-house')).toBe('/t/burger-house/gulshan/dine-in?table=12&k=abcd1234');
  });

  it('never adds a table to an online link', () => {
    go('/t/burger-house/gulshan/dine-in/menu?table=12');
    setTable('burger-house', '12');
    expect(withTable('/t/burger-house/gulshan/menu', 'burger-house')).toBe('/t/burger-house/gulshan/menu');
  });

  it("uses the page's own table when the phone remembers none (storage cleared or blocked)", () => {
    go('/t/burger-house/gulshan/dine-in/menu?table=7&k=wxyz9876');
    expect(getTable('burger-house')).toBeNull();
    expect(withTable('/t/burger-house/gulshan/dine-in', 'burger-house')).toBe('/t/burger-house/gulshan/dine-in?table=7&k=wxyz9876');
  });

  it("doesn't carry the page's table to another branch", () => {
    go('/t/burger-house/gulshan/dine-in/menu?table=7');
    expect(withTable('/t/burger-house/banani/dine-in', 'burger-house')).toBe('/t/burger-house/banani/dine-in');
  });

  it("works on the restaurant's own host too", () => {
    (window as any).__STORE__ = { subdomain: 'burger-house' };
    go('/gulshan/dine-in/menu?table=3');
    expect(withTable('/gulshan/dine-in', 'burger-house')).toBe('/gulshan/dine-in?table=3');
    delete (window as any).__STORE__;
  });
});

describe('setTable without storage', () => {
  it('still remembers the table for this visit', () => {
    go('/t/burger-house/banani/dine-in?table=2');
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setTable('burger-house', '2', 'ipuzsqmr');
    spy.mockRestore();
    expect(getTable('burger-house')).toBe('2');
  });
});
