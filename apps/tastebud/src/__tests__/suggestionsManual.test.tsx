// "+" in the AI suggestions: ordering by hand — one in the tray, the orb steps aside for "View your tray (N)", which
// opens the tray; a dish with sizes opens its popup (as on the menu); "Full menu" is one tap away.
import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CartProvider } from '../context/CartContext';
import SuggestionsModal from '../components/ai-waiter/SuggestionsModal';

jest.mock('../components/ai-waiter/MicInputBar', () => () => null);
jest.mock('../utils/track', () => ({ track: () => {}, trackItemAdded: () => {} }));
jest.mock('../api/cart', () => ({ loadCart: async () => null, saveCart: async () => {} }));
jest.mock('../utils/ws', () => ({ getStableSessionId: () => 'test-session', getWsURL: () => 'ws://test' }));
jest.mock('../api/orders', () => ({ estimateWait: async () => null }));
jest.mock('../api/storefront', () => ({}));
jest.mock('../api/serviceRequests', () => ({}));

const ITEMS = [
  { id: 'brownie', name: 'Chocolate Brownie', price: 220, imageUrl: '', choices: false, orderable: true },
  {
    id: 'shake', name: 'Oreo Milkshake', price: 250, imageUrl: '', choices: true, orderable: true,
    full: { id: 'shake', name: 'Oreo Milkshake', price: 250, variations: [{ name: 'Regular', price: 250 }, { name: 'Large', price: 320 }] },
  },
];

function Harness({ onViewTray }: { onViewTray: () => void }) {
  const [manual, setManual] = React.useState(false);
  return (
    <SuggestionsModal
      open
      onClose={() => {}}
      items={ITEMS}
      voiceBar={false}
      assistant={<div data-testid="orb" />}
      manual={manual}
      onManual={() => setManual(true)}
      onViewTray={onViewTray}
      lang="en"
    />
  );
}

function renderIt(onViewTray = jest.fn()) {
  render(
    <MemoryRouter initialEntries={['/t/burger-house/dine-in?table=5']}>
      <CartProvider>
        <Harness onViewTray={onViewTray} />
      </CartProvider>
    </MemoryRouter>,
  );
  return onViewTray;
}

test('the orb until "+", then "View your tray (N)" — and it opens the tray', () => {
  const onViewTray = renderIt();
  expect(screen.getByTestId('orb')).toBeTruthy();
  expect(screen.queryByText(/View your tray/)).toBeNull();

  act(() => {
    fireEvent.click(screen.getByLabelText('Add Chocolate Brownie'));
  });
  expect(screen.queryByTestId('orb')).toBeNull(); // ordering by hand: no orb
  expect(screen.getByText('View your tray (1 item)')).toBeTruthy();
  expect(screen.getByLabelText('One more Chocolate Brownie')).toBeTruthy(); // "− 1 +"

  act(() => {
    fireEvent.click(screen.getByLabelText('One more Chocolate Brownie'));
  });
  expect(screen.getByText('View your tray (2 items)')).toBeTruthy();

  fireEvent.click(screen.getByText('View your tray (2 items)'));
  expect(onViewTray).toHaveBeenCalledTimes(1);
});

test('a dish with sizes opens its popup, not the tray', () => {
  const onViewTray = renderIt();
  act(() => {
    fireEvent.click(screen.getByLabelText('Add Oreo Milkshake'));
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getAllByText('Large').length).toBeGreaterThan(0);
  expect(onViewTray).not.toHaveBeenCalled();
});

test('"Full menu" goes to the menu', () => {
  renderIt();
  const link = screen.getByText('Full menu').closest('a');
  expect(link?.getAttribute('href')).toContain('/menu');
});
