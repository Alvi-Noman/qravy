import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PrepTime from '../../components/menu-item-modal/PrepTime';
import Variations from '../../components/menu-item-modal/Variations';
import { keyOf, reconcile, seedState, withTrailingBlank } from '../../components/menu-item-modal/variantMatrix';
import { parsePrepMinutes } from '../../hooks/useKitchenSettings';
import { buildDuplicatePayload } from '../../components/menu-items/useMenuItems';
import { applyModalValues, toModalInitial } from '../../components/menu-import/draftUtils';
import type { MenuItem } from '../../api/menuItems';
import type { DraftCategory, DraftItem } from '../../api/menuImports';

describe('prep time field', () => {
  it('shows the restaurant default as the placeholder and picks common times', () => {
    const onChange = vi.fn();
    render(<PrepTime value="" onChange={onChange} defaultMinutes={12} />);
    expect(screen.getByLabelText('Prep time')).toHaveAttribute('placeholder', '12');
    fireEvent.click(screen.getByRole('button', { name: '20 min' }));
    expect(onChange).toHaveBeenLastCalledWith('20');
  });

  it('clicking the selected chip clears it (back to the default); typing keeps digits only', () => {
    const onChange = vi.fn();
    render(<PrepTime value="20" onChange={onChange} defaultMinutes={15} />);
    expect(screen.getByRole('button', { name: '20 min' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '20 min' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    fireEvent.change(screen.getByLabelText('Prep time'), { target: { value: '1a5' } });
    expect(onChange).toHaveBeenLastCalledWith('15');
  });

  it('parses minutes: empty = default, 1–240 whole minutes only', () => {
    expect(parsePrepMinutes('')).toBeNull();
    expect(parsePrepMinutes(' 18 ')).toBe(18);
    expect(parsePrepMinutes('0')).toBe('invalid');
    expect(parsePrepMinutes('241')).toBe('invalid');
  });
});

describe('variant prep times', () => {
  it('seeds, keeps and copies a size’s own prep time', () => {
    const { options, variants } = seedState(
      [
        { label: 'Small', price: '400', optionValues: ['Small'] },
        { label: 'Large', price: '700', optionValues: ['Large'], prepMinutes: '22' },
      ],
      [{ name: 'Size', values: ['Small', 'Large'] }]
    );
    const [small, large] = options[0].values;
    expect(variants[keyOf([small.id])].prepMinutes).toBe('');
    expect(variants[keyOf([large.id])].prepMinutes).toBe('22');

    // adding a second option copies the size's prep time to its new combinations
    const spice = { id: 'sp', name: 'Spice', editing: false, values: withTrailingBlank([{ id: 'h', label: 'Hot' }]) };
    const next = reconcile([options[0], spice], variants);
    expect(next[keyOf([large.id, 'h'])].prepMinutes).toBe('22');
  });

  it('emits the prep time typed for a variant', () => {
    const onChange = vi.fn();
    render(
      <Variations
        value={[
          { label: 'Small', price: '400', optionValues: ['Small'] },
          { label: 'Large', price: '700', optionValues: ['Large'] },
        ]}
        options={[{ name: 'Size', values: ['Small', 'Large'] }]}
        onChange={onChange}
        itemPrepMinutes="15"
      />
    );
    const cell = screen.getByLabelText('Prep minutes for Large');
    expect(cell).toHaveAttribute('placeholder', '15');
    fireEvent.change(cell, { target: { value: '25' } });
    const rows = onChange.mock.calls.at(-1)![0] as Array<{ label: string; prepMinutes?: string }>;
    expect(rows.find((r) => r.label === 'Large')?.prepMinutes).toBe('25');
    expect(rows.find((r) => r.label === 'Small')?.prepMinutes).toBe('');
  });
});

describe('prep time travels with the item', () => {
  it('duplicate keeps the item and variant prep times', () => {
    const item = {
      id: 'i1',
      name: 'Pizza',
      prepMinutes: 18,
      variations: [{ name: 'Large', price: 700, prepMinutes: 22 }],
      tags: [],
      media: [],
      createdAt: '',
      updatedAt: '',
    } as unknown as MenuItem;
    const copy = buildDuplicatePayload(item);
    expect(copy.prepMinutes).toBe(18);
    expect(copy.variations?.[0].prepMinutes).toBe(22);
  });

  it('import review: the modal round-trips prep time and marks an AI estimate as reviewed', () => {
    const draft: DraftItem = {
      tempId: 't1',
      name: 'Kacchi',
      price: 420,
      options: [],
      variations: [],
      tags: [],
      media: [],
      modifierGroups: [],
      prepMinutes: 10,
      prepEstimated: true,
      confidence: 'high',
      issues: [],
      action: 'create',
    };
    const cat: DraftCategory = { tempId: 'c1', name: 'Biryani', items: [draft] };
    expect(toModalInitial(draft, cat).prepMinutes).toBe(10);
    const next = applyModalValues(draft, { name: 'Kacchi', price: 420, prepMinutes: 12 });
    expect(next.prepMinutes).toBe(12);
    expect(next.prepEstimated).toBeUndefined();
  });
});
