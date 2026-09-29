import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Variations from '../../components/menu-item-modal/Variations';
import {
  MAX_VARIANTS,
  buildCombos,
  keyOf,
  reconcile,
  seedState,
  withTrailingBlank,
  type OptionDraft,
  type VariationRow,
  type VariantOption,
} from '../../components/menu-item-modal/variantMatrix';

const opt = (id: string, name: string, values: Array<[string, string]>): OptionDraft => ({
  id,
  name,
  editing: false,
  values: withTrailingBlank(values.map(([vid, label]) => ({ id: vid, label }))),
});

describe('variantMatrix', () => {
  it('builds every combination of option values in option order', () => {
    const { combos, total } = buildCombos([
      opt('size', 'Size', [['s', 'Small'], ['l', 'Large']]),
      opt('spice', 'Spice', [['m', 'Mild'], ['h', 'Hot']]),
    ]);
    expect(total).toBe(4);
    expect(combos.map((c) => c.labels.join(' / '))).toEqual([
      'Small / Mild',
      'Small / Hot',
      'Large / Mild',
      'Large / Hot',
    ]);
  });

  it('ignores blank and duplicate values', () => {
    const { combos } = buildCombos([opt('size', 'Size', [['s', 'Small'], ['x', 'small '], ['b', '  ']])]);
    expect(combos.map((c) => c.labels)).toEqual([['Small']]);
  });

  it('refuses to build more than MAX_VARIANTS combinations', () => {
    const many = (id: string) =>
      opt(id, id, Array.from({ length: 20 }, (_, i) => [`${id}${i}`, `${id}-${i}`] as [string, string]));
    const { combos, total } = buildCombos([many('a'), many('b')]);
    expect(total).toBe(400);
    expect(total).toBeGreaterThan(MAX_VARIANTS);
    expect(combos).toEqual([]);
  });

  it('keeps each size price when a second option is added', () => {
    const size = opt('size', 'Size', [['s', 'Small'], ['l', 'Large']]);
    const prev = reconcile([size], {});
    prev[keyOf(['s'])].price = '100';
    prev[keyOf(['l'])].price = '150';

    const next = reconcile([size, opt('spice', 'Spice', [['m', 'Mild'], ['h', 'Hot']])], prev);
    expect(next[keyOf(['s', 'm'])].price).toBe('100');
    expect(next[keyOf(['s', 'h'])].price).toBe('100');
    expect(next[keyOf(['l', 'm'])].price).toBe('150');
    expect(next[keyOf(['l', 'h'])].price).toBe('150');
  });

  it('keeps prices when a value is renamed or options are reordered', () => {
    const size = opt('size', 'Size', [['s', 'Small']]);
    const spice = opt('spice', 'Spice', [['m', 'Mild']]);
    const prev = reconcile([size, spice], {});
    prev[keyOf(['s', 'm'])].price = '120';

    const renamed = opt('size', 'Size', [['s', 'Regular']]);
    expect(reconcile([spice, renamed], prev)[keyOf(['s', 'm'])].price).toBe('120');
  });

  it('seeds legacy flat variations as a single option', () => {
    const rows: VariationRow[] = [
      { label: 'Half', price: '200' },
      { label: 'Full', price: '380' },
    ];
    const { options, variants } = seedState(rows, []);
    expect(options).toHaveLength(1);
    expect(options[0].values.filter((v) => v.label).map((v) => v.label)).toEqual(['Half', 'Full']);
    expect(Object.values(variants).map((v) => v.price)).toEqual(['200', '380']);
  });

  it('marks saved-but-missing combinations as not offered', () => {
    const options: VariantOption[] = [
      { name: 'Size', values: ['Small', 'Large'] },
      { name: 'Spice', values: ['Mild', 'Hot'] },
    ];
    const rows: VariationRow[] = [
      { label: 'Small / Mild', optionValues: ['Small', 'Mild'], price: '100' },
      { label: 'Large / Mild', optionValues: ['Large', 'Mild'], price: '150' },
      { label: 'Large / Hot', optionValues: ['Large', 'Hot'], price: '160' },
    ];
    const state = seedState(rows, options);
    const { combos } = buildCombos(state.options);
    const byLabel = Object.fromEntries(combos.map((c) => [c.labels.join(' / '), state.variants[c.key]]));
    expect(byLabel['Small / Hot'].disabled).toBe(true);
    expect(byLabel['Large / Hot'].price).toBe('160');
    expect(byLabel['Large / Hot'].disabled).toBeFalsy();
  });
});

describe('<Variations />', () => {
  it('turns option names and values into priced variants', () => {
    const onChange = vi.fn();
    render(<Variations onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /add options like size/i }));
    // one-click preset for the option name
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(screen.getByRole('button', { name: 'Small' }));
    fireEvent.click(screen.getByRole('button', { name: 'Large' }));

    fireEvent.change(screen.getByLabelText('Price for Small'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Price for Large'), { target: { value: '1a8.0.0' } });

    const [rows, options, issue] = onChange.mock.calls.at(-1)!;
    expect(issue).toBeNull();
    expect(options).toEqual([{ name: 'Size', values: ['Small', 'Large'] }]);
    expect(rows.map((r: VariationRow) => [r.label, r.price, r.optionValues])).toEqual([
      ['Small', '120', ['Small']],
      ['Large', '18.00', ['Large']],
    ]);
  });

  it('groups variants by the first option and lets a group price fill its variants', () => {
    const onChange = vi.fn();
    render(
      <Variations
        options={[
          { name: 'Size', values: ['Small', 'Large'] },
          { name: 'Spice', values: ['Mild', 'Hot'] },
        ]}
        value={[
          { label: 'Small / Mild', optionValues: ['Small', 'Mild'], price: '' },
          { label: 'Small / Hot', optionValues: ['Small', 'Hot'], price: '' },
          { label: 'Large / Mild', optionValues: ['Large', 'Mild'], price: '' },
          { label: 'Large / Hot', optionValues: ['Large', 'Hot'], price: '' },
        ]}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Price for all Large variants'), { target: { value: '250' } });
    const rows: VariationRow[] = onChange.mock.calls.at(-1)![0];
    expect(rows.filter((r) => r.optionValues![0] === 'Large').map((r) => r.price)).toEqual(['250', '250']);
    expect(rows.filter((r) => r.optionValues![0] === 'Small').map((r) => r.price)).toEqual(['', '']);

    // Removing a combination drops it from what gets saved
    // (groups start expanded for small tables; first "Hot" row is under Small)
    fireEvent.click(screen.getAllByRole('button', { name: "Don't offer Hot" })[0]);
    const after: VariationRow[] = onChange.mock.calls.at(-1)![0];
    expect(after).toHaveLength(3);
  });

  it('reports an issue when an option has values but no name', () => {
    const onChange = vi.fn();
    render(<Variations onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add options like size/i }));
    const valueInput = screen.getByPlaceholderText('e.g. Small');
    act(() => {
      fireEvent.change(valueInput, { target: { value: 'Regular' } });
    });
    expect(onChange.mock.calls.at(-1)![2]).toMatch(/fix the highlighted/i);
  });
});
