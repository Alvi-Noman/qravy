import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// MenuRow reads scope + permissions from context; stub both
vi.mock('../../context/ScopeContext', () => ({
  useScope: () => ({ activeLocationId: null, channel: 'all' }),
}));
vi.mock('../../hooks/useCapability', () => ({ useSatisfies: () => true }));
vi.mock('../../hooks/useServicePeriods', () => ({ useServicePeriods: () => [] }));

import MenuRow from '../../components/menu-items/MenuRow';
import HoursEditor from '../../components/Categories/HoursEditor';

const baseItem = {
  id: 'i1',
  name: 'Beef Burger',
  price: 350,
  category: 'Burgers',
  media: [],
  variations: [],
  tags: [],
  createdAt: '',
  updatedAt: '',
};

function renderRow(item: any, extra: Record<string, unknown> = {}) {
  return render(
    <table>
      <tbody>
        <MenuRow
          item={item}
          selected={false}
          isNew={false}
          onToggleSelect={vi.fn()}
          onToggleAvailability={vi.fn()}
          onEdit={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
          {...extra}
        />
      </tbody>
    </table>
  );
}

describe('Sold out today', () => {
  it('offers "Sold out today" on items that are on', () => {
    const onSoldOutToday = vi.fn();
    renderRow({ ...baseItem, status: 'active' }, { onSoldOutToday });
    fireEvent.click(screen.getByText('Sold out today'));
    expect(onSoldOutToday).toHaveBeenCalledWith('i1');
  });

  it('shows when a sold-out item comes back', () => {
    const back = new Date();
    back.setDate(back.getDate() + 1);
    back.setHours(5, 0, 0, 0);
    renderRow({ ...baseItem, status: 'hidden', hidden: true, soldOutUntil: back.toISOString() }, { onSoldOutToday: vi.fn() });
    expect(screen.getByText(/^Back tomorrow/)).toBeTruthy();
    expect(screen.queryByText('Sold out today')).toBeNull();
  });

  it('hides the action for users who cannot toggle availability', () => {
    renderRow({ ...baseItem, status: 'active' });
    expect(screen.queryByText('Sold out today')).toBeNull();
  });
});

describe('<HoursEditor /> labels', () => {
  it('uses custom wording and default slot for opening hours', () => {
    const onChange = vi.fn();
    render(
      <HoursEditor
        value={[]}
        onChange={onChange}
        label="Open only at certain times"
        help="Leave unticked if you take orders around the clock."
        defaultWindow={{ days: [0, 1, 2, 3, 4, 5, 6], start: '11:00', end: '23:00' }}
      />
    );
    fireEvent.click(screen.getByLabelText('Open only at certain times'));
    expect(onChange).toHaveBeenCalledWith([{ days: [0, 1, 2, 3, 4, 5, 6], start: '11:00', end: '23:00' }]);
    expect(screen.getByText('Leave unticked if you take orders around the clock.')).toBeTruthy();
  });
});
