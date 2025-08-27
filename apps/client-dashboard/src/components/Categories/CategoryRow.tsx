import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  PencilSquareIcon,
  TrashIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import type { Category } from '../../api/categories';

export default function CategoryRow({
  category,
  usageCount,
  selected,
  active,
  disabled,
  onToggleSelect,
  onToggleAvailability,
  onEdit,
  onDelete,
}: {
  category: Category;
  usageCount: number;
  selected: boolean;
  active: boolean;
  disabled?: boolean;
  onToggleSelect: (id: string) => void;
  onToggleAvailability: (category: Category, active: boolean) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_WIDTH = 160;

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = () => setMenuOpen(false);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [menuOpen]);

  const recalcMenuPos = () => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const margin = 8;
    let left = rect.right - MENU_WIDTH;
    left = Math.max(margin, Math.min(left, window.innerWidth - MENU_WIDTH - margin));
    const top = rect.bottom + margin;
    setMenuPos({ top, left });
  };

  useLayoutEffect(() => {
    if (menuOpen) recalcMenuPos();
    else setMenuPos(null);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onScrollOrResize = () => recalcMenuPos();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [menuOpen]);

  const manageHref = `/categories/manage?c=${encodeURIComponent(category.name)}`;

  return (
    <tr className="border-t border-[#f2f2f2] hover:bg-[#fafafa]">
      <td className="px-3 py-3 align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(category.id)}
          aria-label={`Select ${category.name}`}
          className="h-4 w-4 rounded border-[#cecece] text-[#2e2e30] focus:ring-[#2e2e30]"
        />
      </td>

      <td className="px-3 py-3 align-middle">
        {/* Clickable category name -> Manage Categories with this category preselected */}
        <Link
          to={manageHref}
          state={{ selectedCategory: category.name }}
          className="group block max-w-full"
          title={`Manage ${category.name}`}
        >
          <div className="truncate font-medium text-[#111827] group-hover:underline">
            {category.name}
          </div>
          <div className="text-xs text-[#9b9ba1]">
            Added {new Date(category.createdAt).toLocaleDateString()}
          </div>
        </Link>
      </td>

      <td className="px-3 py-3 align-middle">
        {usageCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-[#f1f2f4] px-2 py-0.5 text-xs text-[#44464b]">
            {usageCount} item{usageCount > 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-xs text-[#9ca3af]">No items</span>
        )}
      </td>

      <td className="px-3 py-3 align-middle">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={() => !disabled && onToggleAvailability(category, !active)}
          disabled={disabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
            active ? 'bg-slate-400' : 'bg-slate-300'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
              active ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </td>

      <td className="px-3 py-3 align-middle text-right">
        <button
          ref={anchorRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-md p-1.5 text-[#111827] hover:bg-[#f3f4f6]"
        >
          <EllipsisHorizontalIcon className="h-7 w-7" />
        </button>

        {typeof window !== 'undefined' &&
          createPortal(
            <AnimatePresence>
              {menuOpen && menuPos ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                  className="z-[1000] w-40 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ul className="py-1 text-sm">
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onEdit(category);
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
                          setMenuOpen(false);
                          onDelete(category);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-[#fff0f0]"
                      >
                        <TrashIcon className="h-4 w-4" />
                        Delete
                      </button>
                    </li>
                  </ul>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body
          )}
      </td>
    </tr>
  );
}