import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  PencilSquareIcon,
  TrashIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import type { MenuItem as TMenuItem } from '../../api/menu';

export default function MenuItemsTable({
  items,
  onToggleAvailability,
  onEdit,
  onDelete,
}: {
  items: TMenuItem[];
  onToggleAvailability: (id: string, active: boolean) => void;
  onEdit: (item: TMenuItem) => void;
  onDelete: (id: string) => void;
}) {
  const [actionOpenId, setActionOpenId] = useState<string | null>(null);

  // Close row actions menu on outside click
  useEffect(() => {
    if (!actionOpenId) return;
    const onClick = () => setActionOpenId(null);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [actionOpenId]);

  return (
    <div className="rounded-lg border border-[#ececec] bg-white">
      <div className="w-full overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[#fafafa] text-[#5b5b5d]">
            <tr className="text-left">
              <th className="px-3 py-3 w-[45%]">Product</th>
              <th className="px-3 py-3 w-[20%]">Category</th>
              <th className="px-3 py-3 w-[15%]">Price</th>
              <th className="px-3 py-3 w-[10%]">Availability</th>
              <th className="px-3 py-3 w-[10%] text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const itAny = item as any;
              const active = !(itAny.hidden || itAny.status === 'hidden');

              return (
                <tr key={item.id} className="border-t border-[#f2f2f2] hover:bg-[#fafafa]">
                  <td className="px-3 py-4 align-middle">
                    <div className="flex items-center gap-3">
                      <Avatar name={item.name} imageUrl={itAny.imageUrl} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[#111827]">{item.name}</div>
                        {item.description ? (
                          <div className="truncate text-xs text-[#6b7280]">{item.description}</div>
                        ) : null}
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-4 align-middle">
                    {item.category ? (
                      <span className="inline-flex items-center rounded-full bg-[#f1f2f4] px-2 py-0.5 text-xs text-[#44464b]">
                        {item.category}
                      </span>
                    ) : (
                      <span className="text-xs text-[#9ca3af]">Uncategorized</span>
                    )}
                  </td>

                  <td className="px-3 py-4 align-middle font-medium text-[#111827]">
                    ${item.price.toFixed(2)}
                  </td>

                  <td className="px-3 py-4 align-middle">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      onClick={() => onToggleAvailability(item.id, !active)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                        active ? 'bg-slate-400' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          active ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>

                  <td className="px-3 py-4 align-middle text-right">
                    <div className="relative inline-block text-left">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionOpenId((prev) => (prev === item.id ? null : item.id));
                        }}
                        className="rounded-md p-1.5 text-[#111827] hover:bg-[#f3f4f6]"
                      >
                        <EllipsisHorizontalIcon className="h-7 w-7" />
                      </button>

                      <AnimatePresence>
                        {actionOpenId === item.id && (
                          <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ul className="py-1 text-sm">
                              <li>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionOpenId(null);
                                    onEdit(item);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5]"
                                >
                                  <PencilSquareIcon className="h-4 w-4 text-[#6b7280]" />
                                  Edit
                                </button>
                              </li>
                              <li>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionOpenId(null);
                                    onDelete(item.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-[#fff0f0]"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                  Delete
                                </button>
                              </li>
                            </ul>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </td>
                </tr>
              );
            })}

            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-[#6b7280]">
                  No items match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Avatar/initial fallback. */
function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const letter = name?.trim()?.[0]?.toUpperCase() || '•';
  if (imageUrl) {
    return <img src={imageUrl} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-[#ececec]" />;
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gradient-to-br from-[#eef2ff] to-[#fdf2f8] text-sm font-semibold text-[#374151] ring-1 ring-[#ececec]">
      {letter}
    </div>
  );
}