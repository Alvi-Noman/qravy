import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../context/ScopeContext', () => ({
  useScope: () => ({ activeLocationId: null, channel: 'all' }),
}));
vi.mock('../../hooks/useCapability', () => ({ useSatisfies: () => true }));
// Restaurant has edited Breakfast to 7–10:30am and added "Iftar"
vi.mock('../../hooks/useServicePeriods', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useServicePeriods')>('../../hooks/useServicePeriods');
  const periods = [
    { id: 'breakfast', name: 'Breakfast', days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '10:30' },
    { id: 'lunch', name: 'Lunch', days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '15:00' },
    { id: 'iftar', name: 'Iftar', days: [0, 1, 2, 3, 4, 5, 6], start: '18:00', end: '20:00' },
  ];
  return { ...actual, useServicePeriods: () => periods };
});

import AvailabilityEditor, { validateAvailability, type AvailabilityValue } from '../../components/availability/AvailabilityEditor';
import BulkHoursDialog from '../../components/menu-items/BulkHoursDialog';
import MenuRow from '../../components/menu-items/MenuRow';
import { validatePeriods } from '../../components/availability/ServicePeriodsCard';

const empty: AvailabilityValue = { servicePeriodIds: [], availability: [] };

describe('<AvailabilityEditor />', () => {
  const renderEditor = (value: AvailabilityValue, onChange = vi.fn(), showDates = false) => {
    render(
      <MemoryRouter>
        <AvailabilityEditor value={value} onChange={onChange} showDates={showDates} />
      </MemoryRouter>
    );
    return onChange;
  };

  it("starts on All day and links the gear to Settings", () => {
    renderEditor(empty);
    expect((screen.getByLabelText('Availability') as HTMLSelectElement).value).toBe('all');
    expect(screen.getByText(/Follows its category and your opening hours/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Manage service periods' }).getAttribute('href')).toBe(
      '/settings/availability#service-periods'
    );
    // nothing else cluttering the default view
    expect(screen.queryByText('Breakfast')).toBeNull();
  });

  it('Service periods: a compact checklist with times, picked by reference', () => {
    const onChange = renderEditor(empty);
    fireEvent.change(screen.getByLabelText('Availability'), { target: { value: 'periods' } });
    expect(screen.getByText('7am–10:30am')).toBeTruthy(); // restaurant's edited Breakfast
    expect(screen.getByText('Iftar')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Breakfast/));
    expect(onChange).toHaveBeenLastCalledWith({ servicePeriodIds: ['breakfast'], availability: [] });
  });

  it('Custom hours: starts with one time slot', () => {
    const onChange = renderEditor(empty);
    fireEvent.change(screen.getByLabelText('Availability'), { target: { value: 'custom' } });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ servicePeriodIds: [], availability: [{ start: '12:00', end: '15:00' }] });
  });

  it('opens in the right mode for saved items', () => {
    renderEditor({ servicePeriodIds: ['lunch'], availability: [] });
    expect((screen.getByLabelText('Availability') as HTMLSelectElement).value).toBe('periods');
    expect((screen.getByLabelText(/Lunch/) as HTMLInputElement).checked).toBe(true);
  });

  it('date range is a small optional link (items only)', () => {
    const onChange = renderEditor(empty, vi.fn(), true);
    fireEvent.click(screen.getByText('+ Add date range'));
    fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '2026-10-03' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, availableFrom: '2026-10-03' });
  });

  it('flags periods that were deleted in Settings', () => {
    const onChange = renderEditor({ servicePeriodIds: ['late-night', 'lunch'], availability: [] });
    expect(screen.getByText(/1 selected period was deleted/)).toBeTruthy();
    fireEvent.click(screen.getByText('Remove'));
    expect(onChange).toHaveBeenLastCalledWith({ servicePeriodIds: ['lunch'], availability: [] });
  });

  it('validates date order', () => {
    expect(validateAvailability({ ...empty, availableFrom: '2026-10-05', availableUntil: '2026-10-03' })).toMatch(/end date/);
    expect(validateAvailability({ ...empty, availableFrom: '2026-10-03', availableUntil: null })).toBeNull();
  });
});

describe('service periods settings', () => {
  it('validates names, days and times', () => {
    const ok = { name: 'Brunch', days: [0, 6], start: '10:00', end: '13:00' };
    expect(validatePeriods([ok])).toBeNull();
    expect(validatePeriods([{ ...ok, name: ' ' }])).toMatch(/name/);
    expect(validatePeriods([ok, { ...ok, name: 'brunch' }])).toMatch(/used twice/);
    expect(validatePeriods([{ ...ok, days: [] }])).toMatch(/day/);
    expect(validatePeriods([{ ...ok, end: '10:00' }])).toMatch(/same time/);
  });
});

describe('bulk availability', () => {
  it('applies service periods to the selected items', () => {
    const onApply = vi.fn();
    render(
      <MemoryRouter>
        <BulkHoursDialog count={3} onClose={vi.fn()} onApply={onApply} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Availability'), { target: { value: 'periods' } });
    fireEvent.click(screen.getByLabelText(/Breakfast/));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ servicePeriodIds: ['breakfast'], availability: [] });
  });

  it('clears availability when nothing is picked', () => {
    const onApply = vi.fn();
    render(
      <MemoryRouter>
        <BulkHoursDialog count={1} onClose={vi.fn()} onApply={onApply} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear availability' }));
    expect(onApply).toHaveBeenCalledWith({ servicePeriodIds: [], availability: [] });
  });
});

describe('menu row availability badge', () => {
  it('names the periods, custom times and dates', () => {
    render(
      <table>
        <tbody>
          <MenuRow
            item={
              {
                id: 'i1',
                name: 'Eid Biryani',
                price: 450,
                media: [],
                variations: [],
                tags: [],
                status: 'active',
                servicePeriodIds: ['iftar'],
                availability: [{ days: [5], start: '12:00', end: '15:00' }],
                availableFrom: '2026-10-03',
                availableUntil: '2026-10-05',
                createdAt: '',
                updatedAt: '',
              } as any
            }
            selected={false}
            isNew={false}
            onToggleSelect={vi.fn()}
            onToggleAvailability={vi.fn()}
            onEdit={vi.fn()}
            onDuplicate={vi.fn()}
            onDelete={vi.fn()}
          />
        </tbody>
      </table>
    );
    expect(screen.getByText('🕐 Iftar · Fri 12pm–3pm · 3 Oct–5 Oct')).toBeTruthy();
  });
});
