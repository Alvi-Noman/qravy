/**
 * Dashboard: per-user menu
 * - List items
 * - Add, Edit, Delete items (drawers from the right)
 * - Listens for "menu:updated" to refresh after category cascades
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createMenuItem,
  getMenuItems,
  updateMenuItem,
  deleteMenuItem,
  type MenuItem as TMenuItem,
  type NewMenuItem,
} from '../../api/menu';
import {
  getCategories,
  createCategory as apiCreateCategory,
  type Category,
} from '../../api/categories';
import { useAuthContext } from '../../context/AuthContext';
import CategorySelect from '../../components/CategorySelect';

export default function Dashboard() {
  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState<null | TMenuItem>(null);
  const queryClient = useQueryClient();
  const { token } = useAuthContext();

  const itemsQuery = useQuery({
    queryKey: ['menu-items', token],
    queryFn: () => getMenuItems(token as string),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', token],
    queryFn: () => getCategories(token as string),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const categories = (categoriesQuery.data || []).map((c: Category) => c.name);

  // Listen for menu updates broadcast (e.g., after category cascade delete)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'menu:updated') {
        queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient, token]);

  const createMut = useMutation<TMenuItem, Error, NewMenuItem>({
    mutationFn: (payload) => createMenuItem(payload, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      setOpenAdd(false);
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
        {itemsQuery.isLoading && <div className="text-[#5b5b5d]">Loading menu…</div>}
        {itemsQuery.isError && <div className="text-red-600">Failed to load menu.</div>}

        {!itemsQuery.isLoading && !itemsQuery.isError && (
          <>
            {!itemsQuery.data || itemsQuery.data.length === 0 ? (
              <EmptyState onAdd={() => setOpenAdd(true)} />
            ) : (
              <MenuList
                items={itemsQuery.data}
                onEdit={(item) => setOpenEdit(item)}
                onDelete={(id) => {
                  if (confirm('Delete this item?')) deleteMut.mutate({ id });
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Drawers */}
      <AnimatePresence>
        {openAdd && (
          <ProductDrawer
            key="add"
            title="Add Product"
            categories={categories}
            initial={{ name: '', price: '', category: '', description: '' }}
            onClose={() => setOpenAdd(false)}
            onSubmit={(values) => createMut.mutate(values)}
          />
        )}

        {openEdit && (
          <ProductDrawer
            key="edit"
            title="Edit Product"
            categories={categories}
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
          />
        )}
      </AnimatePresence>
    </div>
  );
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
          {item.description && (
            <p className="text-sm mt-2 text-[#2e2e30]">{item.description}</p>
          )}

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

function ProductDrawer({
  title,
  categories,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  categories: string[];
  initial: ProductValues;
  onClose: () => void;
  onSubmit: (values: { name: string; price: number; description?: string; category?: string }) => void;
}) {
  const [values, setValues] = useState<ProductValues>(initial);
  const [localError, setLocalError] = useState<string | null>(null);

  const { token } = useAuthContext();
  const queryClient = useQueryClient();

  // Maintain a local categories list so the dropdown updates instantly
  const [localCats, setLocalCats] = useState<string[]>(categories);
  useEffect(() => setLocalCats(categories), [categories]);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const createCatMut = useMutation({
    mutationFn: (name: string) => apiCreateCategory(name, token as string),
    onSuccess: (created) => {
      setLocalCats((prev) => (prev.includes(created.name) ? prev : [...prev, created.name].sort()));
      setValues((s) => ({ ...s, category: created.name }));
      queryClient.setQueryData<Category[]>(
        ['categories', token],
        (prev) => {
          const list = prev ?? [];
          const exists = list.some((c) => c.name === created.name);
          return exists ? list : [...list, created].sort((a, b) => a.name.localeCompare(b.name));
        }
      );
      try {
        localStorage.setItem('categories:updated', String(Date.now()));
      } catch {}
      queryClient.invalidateQueries({ queryKey: ['categories', token] });
    },
  });

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
      category: values.category || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      {/* Drawer */}
      <motion.aside
        className="absolute right-0 top-0 h-screen w-full sm:w-[420px] md:w-[520px] bg-white shadow-2xl flex flex-col"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
        aria-modal="true"
        role="dialog"
      >
        {/* Header (sticky) */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#ececec] sticky top-0 bg-white">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="text-[#5b5b5d] hover:text-[#2e2e30]" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Body (scrollable) */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              className="w-full border border-[#cecece] rounded-md px-3 py-2"
              value={values.name}
              onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))}
              placeholder="e.g., Margherita Pizza"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Price</label>
            <input
              className="w-full border border-[#cecece] rounded-md px-3 py-2"
              value={values.price}
              onChange={(e) => setValues((s) => ({ ...s, price: e.target.value }))}
              placeholder="e.g., 8.99"
              inputMode="decimal"
              required
            />
          </div>

          <div>
            <CategorySelect
              label="Category"
              value={values.category || ''}
              categories={localCats}
              onChange={(val) => setValues((s) => ({ ...s, category: val }))}
              onCreateCategory={async (name) => {
                const created = await createCatMut.mutateAsync(name);
                return created.name;
              }}
              placeholder="Uncategorized"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              className="w-full border border-[#cecece] rounded-md px-3 py-2"
              rows={3}
              value={values.description || ''}
              onChange={(e) => setValues((s) => ({ ...s, description: e.target.value }))}
              placeholder="Short description"
            />
          </div>

          {(localError || createCatMut.isError) && (
            <div className="text-red-600 text-sm">
              {localError || (createCatMut.error as Error)?.message || 'Something went wrong.'}
            </div>
          )}
        </form>

        {/* Footer (sticky) */}
        <div className="px-4 py-3 border-t border-[#ececec] sticky bottom-0 bg-white flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-md border border-[#cecece] text-[#2e2e30] hover:bg-[#f5f5f5]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            formAction="submit"
            onClick={(e) => {
              const form = (e.currentTarget.closest('aside') as HTMLElement)?.querySelector('form');
              (form as HTMLFormElement)?.requestSubmit();
            }}
            className="px-4 py-2 rounded-md text-white bg-[#2e2e30] hover:opacity-90"
          >
            Save
          </button>
        </div>
      </motion.aside>
    </div>
  );
}