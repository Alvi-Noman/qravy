/**
 * Menu Items page (moved from Dashboard)
 * - List items
 * - Add, Edit, Delete items (drawer from the right)
 * - CategorySelect with inline “Add New Category” inside the dropdown
 * - React Query-based data loading
 */
import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
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
  type Category,
} from '../../api/categories';
import { useAuthContext } from '../../context/AuthContext';
import ProductDrawer from '../../components/ProductDrawer';

export default function MenuItemsPage() {
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

  // Listen for menu updates (e.g., after category cascade) from other tabs/routes
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
      <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Menu Items</h2>
        <button
          className="px-4 py-2 bg-[#2e2e30] text-white rounded-md hover:opacity-90"
          onClick={() => setOpenAdd(true)}
        >
          Add Product
        </button>
      </div>

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