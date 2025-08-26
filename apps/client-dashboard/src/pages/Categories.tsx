/**
 * Categories page
 * - Add, Edit (inline), Delete
 * - Broadcasts updates so dashboard and other tabs refresh
 */
import { useEffect, useState } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  type Category,
} from '../api/categories';

export default function CategoriesPage() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['categories', token],
    queryFn: () => getCategories(token as string),
    enabled: !!token,
  });

  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const broadcast = () => {
    try {
      localStorage.setItem('categories:updated', String(Date.now()));
      localStorage.setItem('menu:updated', String(Date.now())); // notify menu pages too
    } catch {}
  };

  const createMut = useMutation({
    mutationFn: (n: string) => createCategory(n, token as string),
    onSuccess: (created) => {
      queryClient.setQueryData<Category[]>(
        ['categories', token],
        (prev) => {
          const list = prev ?? [];
          const exists = list.some((c) => c.name === created.name);
          return exists ? list : [...list, created].sort((a, b) => a.name.localeCompare(b.name));
        }
      );
      setName('');
      broadcast();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, newName }: { id: string; newName: string }) =>
      updateCategory(id, newName, token as string),
    onSuccess: (updated) => {
      queryClient.setQueryData<Category[]>(
        ['categories', token],
        (prev) => {
          const list = prev ?? [];
          const next = list.map((c) => (c.id === updated.id ? updated : c));
          return next.sort((a, b) => a.name.localeCompare(b.name));
        }
      );
      setEditingId(null);
      setEditingName('');
      broadcast();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCategory(id, token as string),
    onSuccess: (_data, id) => {
      // Update categories cache
      queryClient.setQueryData<Category[]>(
        ['categories', token],
        (prev) => (prev ?? []).filter((c) => c.id !== id)
      );
      // Products may have been deleted by cascade: refresh menu-items
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      broadcast();
    },
  });

  // Listen for broadcasts and refresh
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'categories:updated') {
        queryClient.invalidateQueries({ queryKey: ['categories'] });
        refetch();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient, refetch]);

  return (
    <div className="p-6">
      <div className="mb-4 border-b border-[#ececec] pb-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Categories</h2>
        <p className="text-sm text-[#6b6b70]">Add categories to use in your products.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          createMut.mutate(name.trim());
        }}
        className="mb-6 flex gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          className="flex-1 rounded-md border border-[#cecece] bg-white px-3 py-2 text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#e0e0e5]"
        />
        <button
          type="submit"
          disabled={!name.trim() || createMut.isPending}
          className="rounded-md bg-[#2e2e30] px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
        >
          {createMut.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>

      {isLoading && <div className="text-[#6b6b70]">Loading…</div>}
      {isError && <div className="text-red-600">Failed to load categories.</div>}

      {!isLoading && !isError && (
        <ul className="space-y-2">
          {(data || []).map((c) => {
            const isEditing = editingId === c.id;
            return (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-[#ececec] bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  {!isEditing ? (
                    <>
                      <div className="font-medium text-[#2e2e30] truncate">{c.name}</div>
                      <div className="text-xs text-[#9b9ba1]">
                        Added {new Date(c.createdAt).toLocaleDateString()}
                      </div>
                    </>
                  ) : (
                    <input
                      className="mt-1 w-full rounded-md border border-[#cecece] px-2 py-1 text-sm"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      autoFocus
                    />
                  )}
                </div>

                <div className="ml-3 flex-shrink-0">
                  {!isEditing ? (
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1 text-sm rounded-md border border-[#cecece] hover:bg-[#f5f5f5]"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditingName(c.name);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="px-3 py-1 text-sm rounded-md border border-[#cecece] text-red-600 hover:bg-[#fff0f0]"
                        onClick={() => {
                          if (confirm('Delete this category? All products under it will be deleted.')) {
                            deleteMut.mutate(c.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1 text-sm rounded-md border border-[#cecece] hover:bg-[#f5f5f5]"
                        onClick={() => {
                          setEditingId(null);
                          setEditingName('');
                        }}
                        disabled={updateMut.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        className="px-3 py-1 text-sm rounded-md text-white bg-[#2e2e30] hover:opacity-90"
                        onClick={() => {
                          if (!editingName.trim()) return;
                          updateMut.mutate({ id: c.id, newName: editingName.trim() });
                        }}
                        disabled={updateMut.isPending}
                      >
                        {updateMut.isPending ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {(data || []).length === 0 && (
            <li className="text-[#6b6b70]">No categories yet. Add your first one above.</li>
          )}
        </ul>
      )}
    </div>
  );
}