import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { AuthProvider } from '../../../context/AuthContext';
import ProductDrawer from '../../../components/add-product-drawer/ProductDrawer';
import React, { useState } from 'react';

function AppHarness({
  initialCategories = ['Burger', 'Pizza'],
  initial = { name: '', price: '', description: '', category: '' },
  title = 'Add Product',
}: {
  initialCategories?: string[];
  initial?: { name: string; price: string; description?: string; category?: string };
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string>('');
  const [payload, setPayload] = useState<any>(null);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <button onClick={() => setOpen(true)}>Add Product</button>
        {open && (
          <ProductDrawer
            title={title}
            categories={initialCategories}
            initial={initial}
            onClose={() => setOpen(false)}
            onSubmit={(values) => {
              setPayload(values);
              setToast('Product created');
              setOpen(false);
            }}
          />
        )}
        {toast && <div role="status">Product created</div>}
        {payload && <pre aria-label="payload">{JSON.stringify(payload)}</pre>}
      </AuthProvider>
    </QueryClientProvider>
  );
}

async function openDrawer() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /add product/i }));
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

describe('ProductDrawer', () => {
  it('opens, fills fields, selects existing category, and submits payload', async () => {
    render(<AppHarness />);

    const { user, dialog } = await openDrawer();

    const nameInput = within(dialog).getByPlaceholderText(/e\.g\.,\s*chicken biryani/i);
    await user.type(nameInput, 'Margherita');

    // Two numeric inputs share placeholder "0.00" → first is Price
    const [priceInput] = within(dialog).getAllByPlaceholderText('0.00');
    await user.clear(priceInput);
    await user.type(priceInput, '12.50');

    const catTrigger = within(dialog).getByRole('button', { name: /select a category/i });
    await user.click(catTrigger);
    await user.click(within(dialog).getByRole('button', { name: 'Pizza' }));

    const saveBtn = within(dialog).getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeEnabled();

    await user.click(saveBtn);

    expect(await screen.findByRole('status')).toHaveTextContent(/product created/i);

    const payloadText = screen.getByLabelText('payload').textContent || '';
    const payload = JSON.parse(payloadText);
    // description is omitted when empty → match only present fields
    expect(payload).toMatchObject({
      name: 'Margherita',
      price: 12.5,
      category: 'Pizza',
    });
  });

  it('adds a new category inside the drawer and uses it on submit', async () => {
    // Category creation (MSW)
    server.use(
      http.post('*/api/v1/auth/categories', async ({ request }) => {
        const body = await request.json().catch(() => ({} as any));
        const name = (body as any)?.name || 'NewCat';
        return HttpResponse.json({ item: { id: 'c-new', name } }, { status: 200 });
      })
    );

    render(<AppHarness initialCategories={['Burger']} />);

    const { user, dialog } = await openDrawer();

    const nameInput = within(dialog).getByPlaceholderText(/e\.g\.,\s*chicken biryani/i);
    await user.type(nameInput, 'Cheesecake');

    const [priceInput] = within(dialog).getAllByPlaceholderText('0.00');
    await user.type(priceInput, '8.25');

    const catTrigger = within(dialog).getByRole('button', { name: /select a category/i });
    await user.click(catTrigger);
    await user.click(within(dialog).getByRole('button', { name: /add new category/i }));

    const newCatInput = within(dialog).getByPlaceholderText(/input category name/i);
    await user.type(newCatInput, 'Desserts');

    const addSaveBtn = within(dialog).getByRole('button', { name: /^save$/i });
    await user.click(addSaveBtn);

    // Wait until new category is selected
    expect(await within(dialog).findByRole('button', { name: 'Desserts' })).toBeInTheDocument();

    const saveBtn = within(dialog).getByRole('button', { name: /save changes/i });
    await user.click(saveBtn);

    expect(await screen.findByRole('status')).toHaveTextContent(/product created/i);

    const payload = JSON.parse(screen.getByLabelText('payload').textContent || '{}');
    expect(payload).toMatchObject({
      name: 'Cheesecake',
      price: 8.25,
      category: 'Desserts',
    });
  });

  it('keeps Save disabled until Name, Price, and Category are valid (validation gating)', async () => {
    render(<AppHarness />);

    const { user, dialog } = await openDrawer();

    const saveBtn = within(dialog).getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled(); // empty form

    const nameInput = within(dialog).getByPlaceholderText(/e\.g\.,\s*chicken biryani/i);
    const [priceInput] = within(dialog).getAllByPlaceholderText('0.00');
    const catTrigger = within(dialog).getByRole('button', { name: /select a category/i });

    await user.type(nameInput, 'Soda');
    expect(saveBtn).toBeDisabled();

    await user.type(priceInput, '0');
    expect(saveBtn).toBeDisabled();

    await user.clear(priceInput);
    await user.type(priceInput, '3.50');
    expect(saveBtn).toBeDisabled();

    await user.click(catTrigger);
    await user.click(within(dialog).getByRole('button', { name: 'Burger' }));
    expect(saveBtn).toBeEnabled();
  });

  it('Cancel closes the drawer', async () => {
    render(<AppHarness />);

    const { user } = await openDrawer();

    const cancelBtn = screen.getByRole('button', { name: /^cancel$/i });
    await user.click(cancelBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});