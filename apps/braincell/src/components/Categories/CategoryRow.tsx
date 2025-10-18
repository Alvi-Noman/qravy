// components/categories/CategoryRow.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  PencilSquareIcon,
  TrashIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import type { Category } from '../../api/categories';
import { useScope } from '../../context/ScopeContext';

export default function CategoryRow({
  category,
  usageCount,
  selected,
  active,
  disabled,
  isNew = false,
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
  isNew?: boolean;
  onToggleSelect: (id: string) => void;
  onToggleAvailability: (category: Category, active: boolean) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_WIDTH = 160;

  const { activeLocationId, channel: scopeChannel } = useScope();
  const isBranchView = !!activeLocationId;
  const isChannelScoped = scopeChannel && scopeChannel !== 'all';

  // ----- Scope-aware availability/visibility -----
  const channelScope = (category as any).channelScope as 'all' | 'dine-in' | 'online' | undefined;
  const visibility = ((category as any).visibility || {}) as {
    includedLocationIds?: string[];
    excludedLocationIds?: string[];
  };

  const channelBlocked = useMemo(() => {
    if (!isChannelScoped) return false;
    if (!channelScope || channelScope === 'all') return false;
    // If page is filtered to 'dine-in' but category is 'online' only (or vice versa), block switch
    return (
      (scopeChannel === 'dine-in' && channelScope === 'online') ||
      (scopeChannel === 'online' && channelScope === 'dine-in')
    );
  }, [isChannelScoped, channelScope, scopeChannel]);

  const locationBlocked = useMemo(() => {
    if (!isBranchView) return false;
    const locId = activeLocationId!;
    if (visibility.excludedLocationIds?.length && visibility.excludedLocationIds.includes(locId)) {
      return true;
    }
    if (visibility.includedLocationIds?.length && !visibility.includedLocationIds.includes(locId)) {
      return true;
    }
    return false;
  }, [isBranchView, activeLocationId, visibility]);

  // If the category is blocked by current scope, the toggle should be disabled
  const switchDisabled = disabled || channelBlocked || locationBlocked;

  // Badges to explain why it’s disabled
  const scopeBadges = useMemo(() => {
    const badges: string[] = [];
    if (channelScope === 'dine-in') badges.push('Dine-In only');
    if (channelScope === 'online') badges.push('Online only');
    if (isBranchView && locationBlocked) badges.push('Hidden in this branch');
    return badges;
  }, [channelScope, isBranchView, locationBlocked]);

  // ----- Delete label text -----
  const deleteLabel =
    !isBranchView && !isChannelScoped
      ? 'Delete everywhere'
      : !isBranchView && isChannelScoped
      ? 'Delete from this channel'
      : isBranchView && !isChannelScoped
      ? 'Delete from this location'
      : 'Delete from this channel in this location';

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

  const baseBtn = 'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5]';
  const isDestructive = !isBranchView && !isChannelScoped;
  const deleteBtnClass = isDestructive ? `${baseBtn} text-red-600 hover:bg-[#fff0f0]` : baseBtn;
  const deleteIconClass = isDestructive ? 'h-4 w-4' : 'h-4 w-4 text-[#6b7280]';

  const rowDimmed = switchDisabled; // visually hint scope-blocked rows

  return (
    <tr
      data-item-id={category.id}
      className="border-t border-[#f2f2f2] hover:bg-[#fafafa]"
      style={{
        backgroundColor: isNew ? 'var(--brand-25, #f9fbff)' : undefined,
        opacity: rowDimmed ? 0.75 : 1,
        transition: 'background-color 700ms ease, opacity 200ms ease',
      }}
    >
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
        <Link
          to={manageHref}
          state={{ selectedCategory: category.name }}
          className="group block max-w-full"
          title={`Manage ${category.name}`}
        >
          <div className="truncate font-medium text-[#111827] group-hover:underline">
            {category.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#9b9ba1]">
              Added {new Date(category.createdAt).toLocaleDateString()}
            </span>
            {scopeBadges.map((b) => (
              <span
                key={b}
                className="inline-flex items-center rounded-full border border-[#e5e7eb] bg-[#fafafa] px-2 py-0.5 text-[10px] leading-4 text-[#44464b]"
                title={b}
              >
                {b}
              </span>
            ))}
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
          onClick={() => !switchDisabled && onToggleAvailability(category, !active)}
          disabled={switchDisabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
            active ? 'bg-slate-400' : 'bg-slate-300'
          } ${switchDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={
            switchDisabled
              ? channelBlocked
                ? channelScope === 'online'
                  ? 'Unavailable in Dine-In channel'
                  : 'Unavailable in Online channel'
                : locationBlocked
                ? 'Hidden in this branch'
                : 'Unavailable in this scope'
              : 'Toggle visibility'
          }
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
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Open row actions"
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
                  role="menu"
                >
                  <ul className="py-1 text-sm">
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onEdit(category);
                        }}
                        className={baseBtn}
                        role="menuitem"
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
                        className={deleteBtnClass}
                        role="menuitem"
                      >
                        <TrashIcon className={deleteIconClass} />
                        {deleteLabel}
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
