/**
 * Dashboard: per-user menu
 * - Shows user's own menu items
 * - "Add Product" button opens a modal to create new items
 * - Uses React Query for fetching and mutation
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createMenuItem,
  getMenuItems,
  type MenuItem as TMenuItem,
  type NewMenuItem,
} from '../../api/menu';

export default function Dashboard() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['menu-items'],
    queryFn: getMenuItems,
    retry: false,                 // avoid retry-spam during 404s while backend reloads
    refetchOnWindowFocus: false,  // less noise while you’re debugging
  });

  const createMutation = useMutation<TMenuItem, Error, NewMenuItem>({
    mutationFn: createMenuItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items'] });
      setOpen(false);
    },
  });

  const mutationErrorMessage = createMutation.isError
    ? normalizeError(createMutation.error)
    : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Your Menu</h2>
        <button
          className="px-4 py-2 bg-[#2e2e30] text-white rounded-md hover:opacity-90"
          onClick={() => setOpen(true)}
        >
          Add Product
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 text-[#2e2e30]">
        {isLoading && <div className="text-[#5b5b5d]">Loading menu…</div>}
        {isError && (
          <div className="text-red-600">
            Failed to load menu. Please try again.
          </div>
        )}
        {!isLoading && !isError && (
          <>
            {!data || data.length === 0 ? (
              <EmptyState onAdd={() => setOpen(true)} />
            ) : (
              <MenuList items={data} />
            )}
          </>
        )}
      </div>

      {open && (
        <AddProductModal
          onClose={() => setOpen(false)}
          onSubmit={(values) => createMutation.mutate(values)}
          isSubmitting={createMutation.isPending}
          error={mutationErrorMessage}
        />
      )}
    </div>
  );
}

function normalizeError(err: unknown): string | undefined {
  if (!err) return undefined;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    const anyErr = err as any;
    return anyErr?.message ?? JSON.stringify(anyErr);
  } catch {
    return undefined;
  }
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="text-xl font-medium mb-2">No products yet</div>
        <p className="text-[#5b5b5d] mb-4">
          Create your first menu item to get started.
        </p>
        <button
          className="px-4 py-2 bg-[#2e2e30] text-white rounded-md hover:opacity-90"
          onClick={onAdd}
        >
          Add Product
        </button>
      </div>
    </div>
  );
}

function MenuList({ items }: { items: TMenuItem[] }) {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-lg border border-[#ececec] bg-white p-4"
        >
          <div className="flex items-start justify-between">
            <h3 className="text-base font-semibold">{item.name}</h3>
            <span className="text-sm font-medium text-[#2e2e30]">
              ${item.price.toFixed(2)}
            </span>
          </div>
          {item.category && (
            <div className="text-xs mt-1 text-[#5b5b5d]">{item.category}</div>
          )}
          {item.description && (
            <p className="text-sm mt-2 text-[#2e2e30]">{item.description}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

type AddProductValues = {
  name: string;
  price: string;
  description?: string;
  category?: string;
};

function AddProductModal({
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (values: { name: string; price: number; description?: string; category?: string }) => void;
  isSubmitting: boolean;
  error?: string;
}) {
  const [values, setValues] = useState<AddProductValues>({
    name: '',
    price: '',
    description: '',
    category: '',
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const toNumber = (v: string) => Number(v);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!values.name.trim()) {
      setLocalError('Name is required.');
      return;
    }
    const priceNum = toNumber(values.price);
    if (!values.price || Number.isNaN(priceNum) || priceNum <= 0) {
      setLocalError('Price must be a valid positive number.');
      return;
    }

    onSubmit({
      name: values.name.trim(),
      price: priceNum,
      description: values.description?.trim() || undefined,
      category: values.category?.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#ececec]">
          <h3 className="text-base font-semibold">Add Product</h3>
          <button className="text-[#5b5b5d] hover:text-[#2e2e30]" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4">
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            className="w-full border border-[#cecece] rounded-md px-3 py-2 mb-3"
            value={values.name}
            onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))}
            placeholder="e.g., Margherita Pizza"
            required
          />

          <label className="block text-sm font-medium mb-1">Price</label>
          <input
            className="w-full border border-[#cecece] rounded-md px-3 py-2 mb-3"
            value={values.price}
            onChange={(e) => setValues((s) => ({ ...s, price: e.target.value }))}
            placeholder="e.g., 8.99"
            inputMode="decimal"
            required
          />

          <label className="block text-sm font-medium mb-1">Category (optional)</label>
          <input
            className="w-full border border-[#cecece] rounded-md px-3 py-2 mb-3"
            value={values.category}
            onChange={(e) => setValues((s) => ({ ...s, category: e.target.value }))}
            placeholder="e.g., Pizza"
          />

          <label className="block text-sm font-medium mb-1">Description (optional)</label>
          <textarea
            className="w-full border border-[#cecece] rounded-md px-3 py-2 mb-2"
            value={values.description}
            onChange={(e) => setValues((s) => ({ ...s, description: e.target.value }))}
            placeholder="Short description"
            rows={3}
          />

          {(localError || error) && (
            <div className="text-red-600 text-sm mb-2">
              {localError || error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              className="px-4 py-2 rounded-md border border-[#cecece] text-[#2e2e30] hover:bg-[#f5f5f5]"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-4 py-2 rounded-md text-white ${isSubmitting ? 'bg-[#b0b0b5]' : 'bg-[#2e2e30] hover:opacity-90'}`}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}