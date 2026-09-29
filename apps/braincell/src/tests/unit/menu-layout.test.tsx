import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { validateHours } from '../../components/Categories/HoursEditor';
import DraftCategoryCard from '../../components/menu-import/DraftCategoryCard';
import { draftHasInvalidHours } from '../../components/menu-import/draftUtils';
import type { DraftCategory } from '../../api/menuImports';

describe('serving hours', () => {
  it('validates time slots', () => {
    expect(validateHours([])).toBeNull();
    expect(validateHours([{ days: [1, 2], start: '07:00', end: '11:00' }])).toBeNull();
    expect(validateHours([{ days: [], start: '07:00', end: '11:00' }])).toMatch(/day/);
    expect(validateHours([{ days: [1], start: '07:00', end: '07:00' }])).toMatch(/different/);
    expect(validateHours([{ days: [1], start: '', end: '11:00' }])).toMatch(/start and end/);
  });

  it('blocks importing a draft with broken hours', () => {
    const cat = (availability: DraftCategory['availability']): DraftCategory => ({
      tempId: 't',
      name: 'Breakfast',
      items: [],
      availability,
    });
    expect(draftHasInvalidHours({ categories: [cat([{ days: [0], start: '07:00', end: '11:00' }])] })).toBe(false);
    expect(draftHasInvalidHours({ categories: [cat([{ days: [], start: '07:00', end: '11:00' }])] })).toBe(true);
  });
});

describe('import review: section details', () => {
  const baseProps = {
    existingCategories: [],
    otherCategories: [],
    filter: 'all' as const,
    onRemove: vi.fn(),
    onMoveItem: vi.fn(),
    onEditItem: vi.fn(),
  };

  it('shows detected hours and saves an edited description', () => {
    const onChange = vi.fn();
    render(
      <DraftCategoryCard
        {...baseProps}
        onChange={onChange}
        category={{
          tempId: 'c1',
          name: 'Breakfast',
          description: 'Served with tea',
          availability: [{ days: [1, 2, 3, 4, 5], start: '07:00', end: '11:00' }],
          items: [],
        }}
      />
    );
    expect(screen.getByText('Served Mon, Tue, Wed, Thu, Fri 07:00–11:00')).toBeTruthy();

    const input = screen.getByLabelText('Category description');
    fireEvent.change(input, { target: { value: 'Served with tea or coffee' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'Served with tea or coffee' }));
  });

  it('says "Available all day" when no hours were found', () => {
    render(
      <DraftCategoryCard {...baseProps} onChange={vi.fn()} category={{ tempId: 'c2', name: 'Mains', items: [] }} />
    );
    expect(screen.getByText('Available all day')).toBeTruthy();
  });
});
