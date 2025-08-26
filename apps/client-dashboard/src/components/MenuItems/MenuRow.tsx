import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  PencilSquareIcon,
  TrashIcon,
  EllipsisHorizontalIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import type { MenuItem as TMenuItem } from '../../api/menu';

export default function MenuRow({
  item,
  selected,
  onToggleSelect,
  onToggleAvailability,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: TMenuItem;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleAvailability: (id: string, active: boolean) => void;
  onEdit: (item: TMenuItem) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const itAny = item as any;
  const active = !(itAny.hidden || itAny.status === 'hidden');

  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_WIDTH = 160;

  useEffect(() => {
    if (!open) return;
    const onClick = () => setOpen(false);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open]);

  const recalc = () => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const margin = 8;
    let left = rect.right - MENU_WIDTH;
    left = Math.max(margin, Math.min(left, window.innerWidth - MENU_WIDTH - margin));
    const top = rect.bottom + margin;
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (open) recalc();
    else setPos(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onSR = () => recalc();
    window.addEventListener('resize', onSR);
    window.addEventListener('scroll', onSR, true);
    return () => {
      window.removeEventListener('resize', onSR);
      window.removeEventListener('scroll', onSR, true);
    };
  }, [open]);

  return (
    <tr className="border-t border-[#f2f2f2] hover:bg-[#fafafa]">
      <td className="px-3 py-4 align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item.id)}
          aria-label={`Select ${item.name}`}
          className="h-4 w-4 rounded border-[#cecece] text-[#2e2e30] focus:ring-[#2e2e30]"
        />
      </td>

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
        ${Number(itAny.price ?? 0).toFixed(2)}
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
        <button
          ref={anchorRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="rounded-md p-1.5 text-[#111827] hover:bg-[#f3f4f6]"
        >
          <EllipsisHorizontalIcon className="h-7 w-7" />
        </button>

        {typeof window !== 'undefined' &&
          createPortal(
            <AnimatePresence>
              {open && pos ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  style={{ position: 'fixed', top: pos.top, left: pos.left }}
                  className="z-[1000] w-40 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ul className="py-1 text-sm">
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
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
                          setOpen(false);
                          onDuplicate(item.id);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5]"
                      >
                        <DocumentDuplicateIcon className="h-4 w-4 text-[#6b7280]" />
                        Duplicate
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
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
              ) : null}
            </AnimatePresence>,
            document.body
          )}
      </td>
    </tr>
  );
}

function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const letter = name?.trim()?.[0]?.toUpperCase() || '•';
  if (imageUrl)
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-10 w-10 rounded-md object-cover ring-1 ring-[#ececec]"
      />
    );
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gradient-to-br from-[#eef2ff] to-[#fdf2f8] text-sm font-semibold text-[#374151] ring-1 ring-[#ececec]">
      {letter}
    </div>
  );
}