// apps/tastebud/src/components/ai-waiter/LineEditor.tsx
// Tap a tray line → change its quantity, size, add-ons and kitchen note in one place.
import { useEffect, useMemo, useState } from 'react';
import type { CartItem } from '../../context/CartContext';
import ModifierPicker, {
  picksToModifiers,
  validatePicks,
  type ModifierGroup,
  type ModifierPicks,
} from '../ModifierPicker';
import { money, tr, uiLang } from '../../utils/ui-lang';
import SheetScrollArea, { ScrollLock } from '../SheetScroll';

type Props = {
  line: CartItem | null;
  /** the menu item behind the line (for its sizes and add-on groups) */
  menuItem?: any;
  onClose: () => void;
  onSave: (next: CartItem) => void;
  onRemove: () => void;
};

function groupsOf(menuItem: any): ModifierGroup[] {
  return (Array.isArray(menuItem?.modifierGroups) ? menuItem.modifierGroups : []).map((g: any) => ({
    id: String(g.id),
    name: String(g.name ?? ''),
    min: Number(g.min ?? 0),
    max: Number(g.max ?? (g.options?.length || 1)),
    options: (g.options ?? []).map((o: any) => ({ id: String(o.id), name: String(o.name), price: Number(o.price || 0) })),
  }));
}

export default function LineEditor({ line, menuItem, onClose, onSave, onRemove }: Props) {
  const lang = uiLang();
  const variations: { name: string; price?: number }[] = useMemo(
    () => (Array.isArray(menuItem?.variations) ? menuItem.variations.filter((v: any) => v?.name) : []),
    [menuItem],
  );
  const groups = useMemo(() => groupsOf(menuItem), [menuItem]);

  const [qty, setQty] = useState(1);
  const [variation, setVariation] = useState<string | undefined>(undefined);
  const [picks, setPicks] = useState<ModifierPicks>({});
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!line) return;
    setQty(line.qty);
    setVariation(line.variation);
    const p: ModifierPicks = {};
    for (const m of line.modifiers ?? []) (p[m.groupId] ||= []).push(m.optionId);
    setPicks(p);
    setNotes(line.notes ?? '');
    setTried(false);
  }, [line]);

  useEffect(() => {
    if (!line) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [line, onClose]);

  if (!line) return null;

  const errors = groups.length ? validatePicks(groups, picks) : {};
  const mods = groups.length ? picksToModifiers(groups, picks) : line.modifiers ?? [];
  const base = (() => {
    const v = variations.find((x) => x.name === variation);
    if (v && typeof v.price === 'number') return v.price;
    if (typeof menuItem?.price === 'number') return menuItem.price;
    // no menu data: take the line's price back to its base
    return line.price - (line.modifiers ?? []).reduce((n, m) => n + (m.price || 0), 0);
  })();
  const unit = base + mods.reduce((n, m) => n + (m.price || 0), 0);

  const save = () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    onSave({
      ...line,
      qty,
      variation: variation || undefined,
      modifiers: mods.length ? mods : undefined,
      notes: notes.trim() || undefined,
      price: unit,
    });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={line.name} className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <ScrollLock />
      <div className="relative flex w-full flex-col sm:max-w-md max-h-[88dvh] overflow-hidden rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <h3 className="text-lg font-semibold text-gray-900">{line.name}</h3>
          <button type="button" onClick={onClose} aria-label={tr(lang, 'বন্ধ করুন', 'Close')} className="h-8 w-8 rounded-full hover:bg-gray-100">
            ✕
          </button>
        </div>

        <SheetScrollArea className="px-5 pb-4" fadeFrom="#ffffff">
        {/* quantity */}
        <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
          <span className="text-sm text-gray-700">{tr(lang, 'পরিমাণ', 'Quantity')}</span>
          <div className="flex items-center gap-3">
            <button type="button" aria-label={tr(lang, 'কমান', 'Decrease')} onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="h-9 w-9 rounded-full border border-gray-200 bg-white text-lg">−</button>
            <span className="w-6 text-center font-semibold">{qty}</span>
            <button type="button" aria-label={tr(lang, 'বাড়ান', 'Increase')} onClick={() => setQty((q) => Math.min(50, q + 1))}
              className="h-9 w-9 rounded-full border border-gray-200 bg-white text-lg">+</button>
          </div>
        </div>

        {/* size */}
        {variations.length > 1 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium text-gray-800">{tr(lang, 'সাইজ', 'Size')}</div>
            <div className="flex flex-wrap gap-2">
              {variations.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => setVariation(v.name)}
                  className={`rounded-full px-4 py-2 text-sm border ${
                    variation === v.name ? 'border-[#FA2851] bg-[#FA2851]/10 text-[#FA2851]' : 'border-gray-200 text-gray-700'
                  }`}
                >
                  {v.name}
                  {typeof v.price === 'number' && <span className="ml-1 text-gray-500">{money(v.price)}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* add-ons / required choices */}
        {groups.length > 0 && (
          <div className="mt-4">
            <ModifierPicker groups={groups} picks={picks} onChange={setPicks} errors={tried ? errors : {}} />
          </div>
        )}

        {/* note */}
        <div className="mt-4">
          <label className="text-sm font-medium text-gray-800" htmlFor="line-note">
            {tr(lang, 'রান্নাঘরের জন্য নোট', 'Note for the kitchen')}
          </label>
          <input
            id="line-note"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={140}
            placeholder={tr(lang, 'যেমন: ঝাল কম', 'e.g. less spicy')}
            className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA2851]/40"
          />
        </div>

        </SheetScrollArea>

        {/* always visible — the choices scroll above it */}
        <div className="shrink-0 flex gap-3 border-t border-gray-100 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onRemove} className="rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-700">
            {tr(lang, 'বাদ দিন', 'Remove')}
          </button>
          <button type="button" onClick={save} className="flex-1 rounded-2xl bg-[#FA2851] py-3 font-semibold text-white">
            {tr(lang, `সেভ করুন · ${money(unit * qty)}`, `Save · ${money(unit * qty)}`)}
          </button>
        </div>
      </div>
    </div>
  );
}
