/**
 * Dashboard: per-user menu
 * - List items
 * - Add, Edit, Delete items (modals + confirmation)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createMenuItem,
  getMenuItems,
  updateMenuItem,
  deleteMenuItem,
  type MenuItem as TMenuItem,
  type NewMenuItem,
} from '../../api/menu';
import { useAuthContext } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState<null | TMenuItem>(null);
  const queryClient = useQueryClient();
  const { token } = useAuthContext();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['menu-items', token],
    queryFn: () => getMenuItems(token as string),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const createMut = useMutation<TMenuItem, Error, NewMenuItem>({
    mutationFn: (payload) => createMenuItem(payload, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      setOpenAdd(false);
    },
    onError: (err) => {
      if (!token) navigate('/login', { replace: true });
      console.error('[Create menu item] error:', err);
    },
  });

  const updateMut = useMutation<TMenuItem, Error, { id: string; payload: Partial<NewMenuItem> }>({
    mutationFn: ({ id, payload }) => updateMenuItem(id, payload, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      setOpenEdit(null);
    },
  });

  const deleteMut = useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => deleteMenuItem(id, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Your Menu</h2>
        <button
          className="px-4 py-2 bg-[#2e2e30] text-white rounded-md hover:opacity-90"
          onClick={() => setOpenAdd(true)}
        >
          Add Product
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 text-[#2e2e30]">
        {isLoading && <div className="text-[#5b5b5d]">Loading menu…</div>}
        {isError && <div className="text-red-600">Failed to load menu. Please try again.</div>}
        {!isLoading && !isError && (
          <>
            {!data || data.length === 0 ? (
              <EmptyState onAdd={() => setOpenAdd(true)} />
            ) : (
              <MenuList
                items={data}
                onEdit={(item) => setOpenEdit(item)}
                onDelete={(id) => {
                  if (confirm('Delete this item?')) deleteMut.mutate({ id });
                }}
              />
            )}
          </>
        )}
      </div>

      {openAdd && (
        <ProductModal
          title="Add Product"
          initial={{ name: '', price: '', category: '', description: '' }}
          onClose={() => setOpenAdd(false)}
          onSubmit={(values) => createMut.mutate(values)}
          isSubmitting={createMut.isPending}
          error={normalizeError(createMut.error)}
        />
      )}

      {openEdit && (
        <ProductModal
          title="Edit Product"
          initial={{
            name: openEdit.name,
            price: String(openEdit.price),
            category: openEdit.category || '',
            description: openEdit.description || '',
          }}
          onClose={() => setOpenEdit(null)}
          onSubmit={(values) =>
            updateMut.mutate({
              id: openEdit.id,
              payload: {
                name: values.name,
                price: Number(values.price),
                category: values.category || undefined,
                description: values.description || undefined,
              },
            })
          }
          isSubmitting={updateMut.isPending}
          error={normalizeError(updateMut.error)}
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
    return (err as any)?.message ?? JSON.stringify(err);
  } catch {
    return undefined;
  }
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="text-xl font-medium mb-2">No products yet</div>
        <p className="text-[#5b5b5d] mb-4">Create your first menu item to get started.</p>
        <button className="px-4 py-2 bg-[#2e2e30] text-white rounded-md hover:opacity-90" onClick={onAdd}>
          Add Product
        </button>
      </div>
    </div>
  );
}

function MenuList({
  items,
  onEdit,
  onDelete,
}: {
  items: TMenuItem[];
  onEdit: (item: TMenuItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg border border-[#ececec] bg-white p-4">
          <div className="flex items-start justify-between">
            <h3 className="text-base font-semibold">{item.name}</h3>
            <span className="text-sm font-medium text-[#2e2e30]">${item.price.toFixed(2)}</span>
          </div>
          {item.category && <div className="text-xs mt-1 text-[#5b5b5d]">{item.category}</div>}
          {item.description && <p className="text-sm mt-2 text-[#2e2e30]">{item.description}</p>}

          <div className="flex gap-2 mt-4">
            <button
              className="px-3 py-1 text-sm rounded-md border border-[#cecece] hover:bg-[#f5f5f5]"
              onClick={() => onEdit(item)}
            >
              Edit
            </button>
            <button
              className="px-3 py-1 text-sm rounded-md border border-[#cecece] text-red-600 hover:bg-[#fff0f0]"
              onClick={() => onDelete(item.id)}
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

type ProductValues = {
  name: string;
  price: string;
  description?: string;
  category?: string;
};

function ProductModal({
  title,
  initial,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: {
  title: string;
  initial: ProductValues;
  onClose: () => void;
  onSubmit: (values: { name: string; price: number; description?: string; category?: string }) => void;
  isSubmitting: boolean;
  error?: string;
}) {
  const [values, setValues] = useState<ProductValues>(initial);
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
          <h3 className="text-base font-semibold">{title}</h3>
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
            value={values.category || ''}
            onChange={(e) => setValues((s) => ({ ...s, category: e.target.value }))}
            placeholder="e.g., Pizza"
          />

          <label className="block text-sm font-medium mb-1">Description (optional)</label>
          <textarea
            className="w-full border border-[#cecece] rounded-md px-3 py-2 mb-2"
            value={values.description || ''}
            onChange={(e) => setValues((s) => ({ ...s, description: e.target.value }))}
            placeholder="Short description"
            rows={3}
          />

          {(localError || error) && <div className="text-red-600 text-sm mb-2">{localError || error}</div>}

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