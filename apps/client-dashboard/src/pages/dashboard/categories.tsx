/**
 * Categories page
 * - Add new categories
 * - List existing categories
 */
import { useState } from 'react';
import { useAuthContext } from '../../context/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCategory, getCategories, type Category } from '../../api/categories';

export default function CategoriesPage() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['categories', token],
    queryFn: () => getCategories(token as string),
    enabled: !!token,
  });

  const createMut = useMutation({
    mutationFn: (n: string) => createCategory(n, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', token] });
      setName('');
    },
  });

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
          {(data || []).map((c: Category) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md border border-[#ececec] bg-white px-3 py-2"
            >
              <div>
                <div className="font-medium text-[#2e2e30]">{c.name}</div>
                <div className="text-xs text-[#9b9ba1]">
                  Added {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>
              {/* Future: add rename/delete */}
            </li>
          ))}
          {(data || []).length === 0 && (
            <li className="text-[#6b6b70]">No categories yet. Add your first one above.</li>
          )}
        </ul>
      )}
    </div>
  );
}