import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import CategorySelect from '../../../components/AddProductDrawer/CategorySelect';

function Harness({
  initialValue = '',
  initialCategories = ['Starters', 'Mains', 'Drinks'],
  disabled = false,
  label = 'Category',
  placeholder = 'Select a Category',
  onCreateCategory,
}: {
  initialValue?: string;
  initialCategories?: string[];
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  onCreateCategory?: (name: string) => Promise<string>;
}) {
  const [value, setValue] = useState<string>(initialValue);
  return (
    <div>
      <CategorySelect
        value={value}
        categories={initialCategories}
        onChange={setValue}
        onCreateCategory={
          onCreateCategory ??
          (async (name: string) => {
            // Default stub: simulate a small network delay and return the name
            await new Promise((r) => setTimeout(r, 80));
            return name;
          })
        }
        disabled={disabled}
        label={label}
        placeholder={placeholder}
      />
      <div aria-label="selected-value">{value || ''}</div>
    </div>
  );
}

describe('CategorySelect', () => {
  it('renders label and placeholder, opens menu, and lists categories', async () => {
    render(<Harness />);

    // Label is visible
    expect(screen.getByText('Category')).toBeInTheDocument();

    // Trigger shows placeholder text
    const trigger = screen.getByRole('button', { name: /select a category/i });
    expect(trigger).toBeInTheDocument();

    // Open dropdown
    await userEvent.click(trigger);

    // Options appear
    expect(screen.getByRole('button', { name: 'Starters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mains' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drinks' })).toBeInTheDocument();
    // "Add New Category" control is present
    expect(screen.getByRole('button', { name: /add new category/i })).toBeInTheDocument();
  });

  it('selects an existing category and calls onChange (value updates)', async () => {
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: /select a category/i });
    await userEvent.click(trigger);

    await userEvent.click(screen.getByRole('button', { name: 'Mains' }));

    // Trigger text updates to selected category
    expect(screen.getByRole('button', { name: 'Mains' })).toBeInTheDocument();
    // And our helper mirror shows the new value
    expect(screen.getByLabelText('selected-value')).toHaveTextContent('Mains');
  });

  it('shows "No categories yet" when list is empty', async () => {
    render(<Harness initialCategories={[]} />);

    const trigger = screen.getByRole('button', { name: /select a category/i });
    await userEvent.click(trigger);

    expect(screen.getByText(/no categories yet/i)).toBeInTheDocument();
  });

  it('enters add mode, validates input, and creates a category (shows Saving… then selects it)', async () => {
    // Simulate a slightly delayed creation to observe Saving… state
    const onCreateCategory = async (name: string) => {
      await new Promise((r) => setTimeout(r, 120));
      return name;
    };

    render(<Harness onCreateCategory={onCreateCategory} />);

    // Open dropdown
    const trigger = screen.getByRole('button', { name: /select a category/i });
    await userEvent.click(trigger);

    // Enter add mode
    await userEvent.click(screen.getByRole('button', { name: /add new category/i }));

    const input = screen.getByPlaceholderText(/input category name/i);
    await userEvent.type(input, 'Desserts');

    // Click Save and assert Saving… state
    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    await userEvent.click(saveBtn);

    // While pending, the Save button text changes to "Saving…" and becomes disabled
    expect(await screen.findByRole('button', { name: /saving…/i })).toBeDisabled();

    // After completion, dropdown closes and the trigger shows the new value
    expect(await screen.findByRole('button', { name: 'Desserts' })).toBeInTheDocument();
    expect(screen.getByLabelText('selected-value')).toHaveTextContent('Desserts');
  });

  it('shows error when creation fails and allows retry/cancel', async () => {
    const onCreateCategory = async () => {
      await new Promise((r) => setTimeout(r, 60));
      throw new Error('Name already exists');
    };

    render(<Harness onCreateCategory={onCreateCategory} />);

    const trigger = screen.getByRole('button', { name: /select a category/i });
    await userEvent.click(trigger);

    await userEvent.click(screen.getByRole('button', { name: /add new category/i }));
    const input = screen.getByPlaceholderText(/input category name/i);
    await userEvent.type(input, 'Starters');

    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    await userEvent.click(saveBtn);

    // Error message appears
    expect(await screen.findByText(/name already exists/i)).toBeInTheDocument();

    // Cancel clears and closes add mode
    const cancelBtn = screen.getByRole('button', { name: /^cancel$/i });
    await userEvent.click(cancelBtn);

    // Dropdown remains open (list visible), add mode closed (no input)
    expect(screen.queryByPlaceholderText(/input category name/i)).not.toBeInTheDocument();
  });

  it('clicking outside closes the dropdown', async () => {
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: /select a category/i });
    await userEvent.click(trigger);

    // Verify menu content is visible
    expect(screen.getByRole('button', { name: /add new category/i })).toBeInTheDocument();

    // Click outside (document body)
    fireEvent.mouseDown(document.body);

    // The "Add New Category" button disappears (menu closed)
    expect(screen.queryByRole('button', { name: /add new category/i })).not.toBeInTheDocument();
  });

  it('respects disabled state (does not open)', async () => {
    render(<Harness disabled />);

    const trigger = screen.getByRole('button', { name: /select a category/i });
    expect(trigger).toBeDisabled();

    // Clicking should not open
    await userEvent.click(trigger);
    expect(screen.queryByRole('button', { name: /add new category/i })).not.toBeInTheDocument();
  });
});