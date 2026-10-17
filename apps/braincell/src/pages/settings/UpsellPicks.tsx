// apps/braincell/src/pages/settings/UpsellPicks.tsx — Settings → Upsell & picks: the owner's say over the AI waiter.
//   Upsell rules     — "a guest orders these dishes (or a dish of these categories) → offer this". The rule comes
//                      before the waiter's own offer; the first of its dishes that can be added (on the menu now, not
//                      already in the tray) is offered — said with the price, a "yes" adds it.
//   Suggestion picks — "a guest asks for <words> → show these dishes", in this order (the words as guests say them,
//                      in English or Bangla: "spicy", "ঝাল", "for kids").
// Where no rule fits, the AI decides as before. (ai-waiter-service: offers._owner, brain._owner_pick)
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightIcon, MagnifyingGlassIcon, PlusIcon, SparklesIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { getMenuItems, type MenuItem } from '../../api/menuItems';
import { toastError, toastSuccess } from '../../components/Toaster';

type UpsellRule = { whenItemIds: string[]; whenCategories: string[]; offerItemIds: string[]; on: boolean };
type SuggestRule = { phrases: string[]; itemIds: string[]; on: boolean };

const card = 'rounded-xl border border-[#ececec] bg-white p-4 shadow-sm';
const money = (n: number) => `৳${new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(n)}`;
const MAX_RULES = 50;

/* ------------------------------------------------------------------ the dish (and category) picker */

type Pickable = { key: string; label: string; sub: string; kind: 'item' | 'category' };

function Picker({
  options,
  chosen,
  onAdd,
  placeholder,
  disabled,
}: {
  options: Pickable[];
  chosen: Set<string>;
  onAdd: (p: Pickable) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const s = q.trim().toLowerCase();
  const list = options.filter((o) => !chosen.has(o.key) && (!s || o.label.toLowerCase().includes(s) || o.sub.toLowerCase().includes(s))).slice(0, 40);
  return (
    <div
      ref={wrap}
      className="relative"
      // closes when focus leaves it (tab to the next box) — never left open over the next picker
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-[#9a9aa0]" />
      <input
        value={q}
        disabled={disabled}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-md border border-[#e2e2e2] bg-white py-1.5 pl-8 pr-2 text-sm disabled:bg-slate-50"
      />
      {open && !disabled && (
        <ul className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-[#ececec] bg-white py-1 text-sm shadow-xl">
          {list.length ? (
            list.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  onClick={() => (onAdd(o), setQ(''), setOpen(false))}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-[#f5f5f5]"
                >
                  <span className="min-w-0 truncate text-[#2e2e30]">
                    {o.kind === 'category' && <span className="mr-1.5 rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">Category</span>}
                    {o.label}
                  </span>
                  <span className="shrink-0 text-xs text-[#9a9aa0]">{o.sub}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-xs text-[#9a9aa0]">{s ? 'Nothing matches.' : 'Everything is already chosen.'}</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Chip({ label, onRemove, tone = 'slate', n }: { label: string; onRemove?: () => void; tone?: 'slate' | 'pink'; n?: number }) {
  const cls = tone === 'pink' ? 'bg-[#FFF0F3] text-[#c2183f] ring-[#ffd4de]' : 'bg-slate-50 text-[#2e2e30] ring-[#e5e7eb]';
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ${cls}`}>
      {n !== undefined && <span className="font-semibold opacity-60">{n}.</span>}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="rounded-full p-0.5 hover:bg-black/5">
          <XMarkIcon className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-[#2e2e30]' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

/* ------------------------------------------------------------------ the page */

export default function SettingsUpsellPicks(): JSX.Element {
  const { token } = useAuthContext();
  const qc = useQueryClient();
  const { data: tenant, isLoading } = useTenant();
  const items = useQuery({ queryKey: ['upsell-picks-menu', token], queryFn: () => getMenuItems(token as string), enabled: !!token });

  const savedUpsell = useMemo(() => ((tenant as { upsellRules?: UpsellRule[] } | undefined)?.upsellRules ?? []) as UpsellRule[], [tenant]);
  const savedSuggest = useMemo(() => ((tenant as { suggestRules?: SuggestRule[] } | undefined)?.suggestRules ?? []) as SuggestRule[], [tenant]);
  const [upsell, setUpsell] = useState<UpsellRule[]>([]);
  const [suggest, setSuggest] = useState<SuggestRule[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setUpsell(savedUpsell.map((r) => ({ ...r }))), [savedUpsell]);
  useEffect(() => setSuggest(savedSuggest.map((r) => ({ ...r }))), [savedSuggest]);
  const dirty = JSON.stringify(upsell) !== JSON.stringify(savedUpsell) || JSON.stringify(suggest) !== JSON.stringify(savedSuggest);

  // the menu, as the pickers show it
  const byId = useMemo(() => new Map((items.data ?? []).map((m: MenuItem) => [m.id, m])), [items.data]);
  const dishOptions: Pickable[] = useMemo(
    () =>
      (items.data ?? []).map((m: MenuItem) => ({
        key: m.id,
        label: m.name,
        sub: [m.category, typeof m.price === 'number' ? money(m.price) : ''].filter(Boolean).join(' · '),
        kind: 'item' as const,
      })),
    [items.data]
  );
  const categoryOptions: Pickable[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of items.data ?? []) if (m.category) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    return [...counts].map(([c, n]) => ({ key: `cat:${c}`, label: c, sub: `${n} dish${n === 1 ? '' : 'es'}`, kind: 'category' as const }));
  }, [items.data]);
  const dishName = (id: string) => byId.get(id)?.name ?? 'Removed dish';

  const setRule = <T,>(list: T[], set: (v: T[]) => void, i: number, patch: Partial<T>) => set(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // a rule that can't be saved yet (nothing to react to, nothing to offer / show)
  const incomplete =
    upsell.some((r) => !(r.whenItemIds.length || r.whenCategories.length) || !r.offerItemIds.length) ||
    suggest.some((r) => !r.phrases.length || !r.itemIds.length);

  const save = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await updateTenant({ upsellRules: upsell, suggestRules: suggest }, token);
      await qc.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess('Saved — the AI waiter uses your rules within a minute');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the rules');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="grid gap-4">
      <div className={`${card} flex items-start gap-3`}>
        <SparklesIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#FA2851]" />
        <div className="text-[13px] text-[#4a4a4f]">
          <div className="font-semibold text-[#2e2e30]">Your say over the AI waiter’s offers and suggestions</div>
          Your rules come first. Where none of them fits, the AI waiter decides as usual — from the menu, the time of day and what guests order
          together. Dishes that are sold out or not served right now are skipped automatically.
        </div>
      </div>

      {/* ------------------------------------------------------------ upsell rules */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[14px] font-semibold text-slate-900">Upsell rules</div>
            <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
              When a guest orders one of these dishes, the waiter offers yours: “Would you like a Mint Lemonade with the Smash Burger? (৳160)” — a
              “yes” adds it. If you pick several to offer, the first one that’s available and not already in their tray is offered.
            </p>
          </div>
          <button
            type="button"
            disabled={upsell.length >= MAX_RULES}
            onClick={() => setUpsell([...upsell, { whenItemIds: [], whenCategories: [], offerItemIds: [], on: true }])}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#cecece] bg-white px-3 py-1.5 text-sm text-[#2e2e30] hover:bg-[#f5f5f5] disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" /> Add a rule
          </button>
        </div>

        {upsell.length ? (
          <ul className="mt-4 space-y-3">
            {upsell.map((r, i) => {
              const when = new Set([...r.whenItemIds, ...r.whenCategories.map((c) => `cat:${c}`)]);
              return (
                <li key={i} className={`rounded-lg border p-3 ${r.on ? 'border-[#ececec]' : 'border-dashed border-[#e2e2e2] bg-slate-50/60'}`}>
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-start">
                    <div>
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">When a guest orders</div>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {r.whenCategories.map((c) => (
                          <Chip
                            key={`c-${c}`}
                            label={`Any ${c}`}
                            onRemove={() => setRule(upsell, setUpsell, i, { whenCategories: r.whenCategories.filter((x) => x !== c) })}
                          />
                        ))}
                        {r.whenItemIds.map((id) => (
                          <Chip key={id} label={dishName(id)} onRemove={() => setRule(upsell, setUpsell, i, { whenItemIds: r.whenItemIds.filter((x) => x !== id) })} />
                        ))}
                      </div>
                      <Picker
                        options={[...categoryOptions, ...dishOptions]}
                        chosen={when}
                        placeholder="A dish, or a whole category…"
                        onAdd={(p) =>
                          p.kind === 'category'
                            ? setRule(upsell, setUpsell, i, { whenCategories: [...r.whenCategories, p.label] })
                            : setRule(upsell, setUpsell, i, { whenItemIds: [...r.whenItemIds, p.key] })
                        }
                      />
                    </div>
                    <ArrowRightIcon className="mx-auto hidden h-5 w-5 text-slate-300 md:mt-7 md:block" />
                    <div>
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Offer</div>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {r.offerItemIds.map((id, n) => (
                          <Chip
                            key={id}
                            n={r.offerItemIds.length > 1 ? n + 1 : undefined}
                            tone="pink"
                            label={dishName(id)}
                            onRemove={() => setRule(upsell, setUpsell, i, { offerItemIds: r.offerItemIds.filter((x) => x !== id) })}
                          />
                        ))}
                      </div>
                      <Picker
                        options={dishOptions}
                        chosen={new Set(r.offerItemIds)}
                        disabled={r.offerItemIds.length >= 5}
                        placeholder={r.offerItemIds.length >= 5 ? 'Up to 5 dishes' : 'The dish to offer…'}
                        onAdd={(p) => setRule(upsell, setUpsell, i, { offerItemIds: [...r.offerItemIds, p.key] })}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#f0f0f0] pt-2.5 text-xs text-slate-500">
                    <label className="flex items-center gap-2">
                      <Toggle on={r.on} onChange={(v) => setRule(upsell, setUpsell, i, { on: v })} label="Rule on" />
                      {r.on ? 'On' : 'Off'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setUpsell(upsell.filter((_, j) => j !== i))}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                    >
                      <TrashIcon className="h-4 w-4" /> Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-[13px] text-slate-600">
            No upsell rules yet — the AI waiter offers what completes each order (a drink, a side, a dessert). Add one to choose it yourself, e.g.
            Smash Burger → Mint Lemonade.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------ suggestion picks */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[14px] font-semibold text-slate-900">Suggestion picks</div>
            <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
              When a guest asks for something like these words, the waiter shows exactly your dishes, in your order. Add the words the way guests
              say them — in English and in Bangla (“spicy”, “ঝাল”, “for kids”, “বাচ্চাদের”).
            </p>
          </div>
          <button
            type="button"
            disabled={suggest.length >= MAX_RULES}
            onClick={() => setSuggest([...suggest, { phrases: [], itemIds: [], on: true }])}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#cecece] bg-white px-3 py-1.5 text-sm text-[#2e2e30] hover:bg-[#f5f5f5] disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" /> Add picks
          </button>
        </div>

        {suggest.length ? (
          <ul className="mt-4 space-y-3">
            {suggest.map((r, i) => (
              <li key={i} className={`rounded-lg border p-3 ${r.on ? 'border-[#ececec]' : 'border-dashed border-[#e2e2e2] bg-slate-50/60'}`}>
                <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-start">
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">When a guest asks for</div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {r.phrases.map((p) => (
                        <Chip key={p} label={`“${p}”`} onRemove={() => setRule(suggest, setSuggest, i, { phrases: r.phrases.filter((x) => x !== p) })} />
                      ))}
                    </div>
                    <input
                      placeholder={r.phrases.length >= 10 ? 'Up to 10 words' : 'Type a word and press Enter — e.g. spicy'}
                      disabled={r.phrases.length >= 10}
                      maxLength={40}
                      onKeyDown={(e) => {
                        const v = (e.target as HTMLInputElement).value.trim();
                        if ((e.key === 'Enter' || e.key === ',') && v.length >= 2) {
                          e.preventDefault();
                          if (!r.phrases.some((x) => x.toLowerCase() === v.toLowerCase())) setRule(suggest, setSuggest, i, { phrases: [...r.phrases, v] });
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v.length >= 2 && !r.phrases.some((x) => x.toLowerCase() === v.toLowerCase()) && r.phrases.length < 10) {
                          setRule(suggest, setSuggest, i, { phrases: [...r.phrases, v] });
                          e.target.value = '';
                        }
                      }}
                      className="w-full rounded-md border border-[#e2e2e2] bg-white px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                    />
                  </div>
                  <ArrowRightIcon className="mx-auto hidden h-5 w-5 text-slate-300 md:mt-7 md:block" />
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Show these, in this order</div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {r.itemIds.map((id, n) => (
                        <Chip
                          key={id}
                          n={n + 1}
                          tone="pink"
                          label={dishName(id)}
                          onRemove={() => setRule(suggest, setSuggest, i, { itemIds: r.itemIds.filter((x) => x !== id) })}
                        />
                      ))}
                    </div>
                    <Picker
                      options={dishOptions}
                      chosen={new Set(r.itemIds)}
                      disabled={r.itemIds.length >= 8}
                      placeholder={r.itemIds.length >= 8 ? 'Up to 8 dishes' : 'A dish to show…'}
                      onAdd={(p) => setRule(suggest, setSuggest, i, { itemIds: [...r.itemIds, p.key] })}
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#f0f0f0] pt-2.5 text-xs text-slate-500">
                  <label className="flex items-center gap-2">
                    <Toggle on={r.on} onChange={(v) => setRule(suggest, setSuggest, i, { on: v })} label="Picks on" />
                    {r.on ? 'On' : 'Off'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setSuggest(suggest.filter((_, j) => j !== i))}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                  >
                    <TrashIcon className="h-4 w-4" /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-[13px] text-slate-600">
            No picks yet — the AI waiter chooses what fits each ask. Add some to decide yourself, e.g. “spicy”, “ঝাল” → Hot Wings, Peri Peri Fries.
          </p>
        )}
      </div>

      {dirty && (
        <div className="sticky bottom-4 z-10 mx-auto w-full max-w-2xl rounded-xl border border-[#ececec] bg-white/95 p-3 shadow-md backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-800">
              {incomplete ? (
                <span className="text-amber-700">Each rule needs both sides filled in before it can be saved.</span>
              ) : saving ? (
                'Saving…'
              ) : (
                'Unsaved changes'
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm"
                onClick={() => (setUpsell(savedUpsell.map((r) => ({ ...r }))), setSuggest(savedSuggest.map((r) => ({ ...r }))))}
              >
                Discard
              </button>
              <button
                type="button"
                disabled={saving || incomplete}
                onClick={save}
                className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
