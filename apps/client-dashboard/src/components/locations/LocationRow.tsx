import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  PencilSquareIcon,
  TrashIcon,
  EllipsisHorizontalIcon,
  MapPinIcon as MapPinOutline,
} from '@heroicons/react/24/outline';
import { MapPinIcon as MapPinSolid } from '@heroicons/react/24/solid';
import type { Location } from '../../api/locations';

export default function LocationRow({
  location,
  isNew = false,
  isDefault = false,
  onToggleDefault,
  onEdit,
  onDelete,
}: {
  location: Location;
  isNew?: boolean;
  isDefault?: boolean;
  onToggleDefault: (location: Location) => void;
  onEdit: (location: Location) => void;
  onDelete: (location: Location) => void;
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

  const manageHref = `/locations/manage?l=${encodeURIComponent(location.name)}`;

  return (
    <tr
      data-item-id={location.id}
      className="border-t border-[#f2f2f2] hover:bg-[#fafafa]"
      style={{
        backgroundColor: isNew ? 'var(--brand-25, #f9fbff)' : undefined,
        transition: 'background-color 700ms ease',
      }}
    >
      {/* Default pin */}
      <td className="px-3 py-3 align-middle text-center">
        <button
          type="button"
          aria-pressed={isDefault}
          aria-label={isDefault ? 'Remove default' : 'Set as default'}
          onClick={(e) => {
            e.stopPropagation();
            // Always delegate to parent; it decides whether to show Set or Remove dialog
            onToggleDefault(location);
          }}
          className={[
            'inline-flex items-center justify-center rounded p-1.5 transition',
            'hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-300',
            isDefault ? 'text-[#111827]' : 'text-slate-400 hover:text-slate-600',
          ].join(' ')}
          title={isDefault ? 'Remove default' : 'Set as default'}
        >
          {isDefault ? (
            <MapPinSolid className="h-5 w-5" />
          ) : (
            <MapPinOutline className="h-5 w-5" />
          )}
        </button>
      </td>

      {/* Name */}
      <td className="px-3 py-3 align-middle">
        <Link
          to={manageHref}
          className="group block max-w-full"
          title={`Manage ${location.name}`}
        >
          <div className="truncate font-medium text-[#111827] group-hover:underline">
            {location.name}
          </div>
        </Link>
      </td>

      {/* Address */}
      <td className="px-3 py-3 align-middle">
        <div
          className="max-w-[28ch] md:max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap text-[#2e2e30]"
          title={location.address}
        >
          {location.address || '—'}
        </div>
      </td>

      {/* ZIP/Postal */}
      <td className="px-3 py-3 align-middle">{location.zip || '—'}</td>

      {/* Country */}
      <td className="px-3 py-3 align-middle">{location.country || '—'}</td>

      {/* Actions */}
      <td className="px-3 py-3 align-middle text-right">
        <button
          ref={anchorRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-md p-1.5 text-[#111827] hover:bg-[#f3f4f6]"
          aria-label="More actions"
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
                          onEdit(location);
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
                          onDelete(location);
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