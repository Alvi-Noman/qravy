// apps/braincell/src/pages/settings/NowAnswers.tsx — Settings → What to eat now: what the AI waiter says when a guest
// asks "এখন কি খেতে পারি?", one answer for each time of day. The owner writes it as plain sentences; each dish is a pill
// with a first choice, up to two backups (for when it's sold out or not served then) and how the waiter says it.
// The waiter says the first choice of each that can be ordered at that moment, leaves out a dish with none (and the
// word that joined it) and skips a sentence whose dishes are all gone (ai-waiter-service now_answers.py — the preview
// here does the same). A time with no answer of the owner's: the waiter's own, shown as the starting point.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant, type NowAnswerToken, type NowSlot } from '../../api/tenant';
import { waiterFetch } from '../../api/waiter';
import { toastError, toastSuccess } from '../../components/Toaster';

type Dish = { id: string; name: string; category: string; price?: number; said: string; kind: string };
type Suggested = {
  slots: { key: NowSlot; from: string; to: string; sampleAt: string }[];
  items: Dish[];
  on: Record<NowSlot, string[]>;
  suggested: Record<NowSlot, NowAnswerToken[][]>;
};
type Line = NowAnswerToken[];

const SLOT_LABEL: Record<NowSlot, string> = { morning: 'Morning', lunch: 'Lunch', evening: 'Evening', night: 'Night' };
const QUESTIONS = ['এখন কি খেতে পারি?', 'কি খাওয়া যেতে পারে?', 'খাওয়ার মত কি আছে?', 'What can I eat now?'];
const card = 'rounded-xl border border-[#ececec] bg-white shadow-sm';
const money = (n?: number) => (typeof n === 'number' ? `৳${new Intl.NumberFormat('en-BD').format(n)}` : '');
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------------------------------------------------------- what the guest hears (as the waiter says it) */

// the few characters between two dishes that only join them (", ", " আর ", " or ") — they go with a dish left out
const joiner = (t: string) => {
  const core = t.replace(/[\s,;:।॥.]+/g, ' ').trim();
  return core.length <= 8 && core.split(' ').filter(Boolean).length <= 1;
};
type Heard = { parts: { text?: string; dish?: string; swap?: boolean }[] }[];
function hear(lines: Line[], byId: Map<string, Dish>, can: (id: string) => boolean, notes: string[]): Heard {
  const out: Heard = [];
  for (const line of lines) {
    const parts: { text?: string; dish?: string; swap?: boolean; gone?: boolean; isDish?: boolean }[] = line.map((t) => {
      if (t.t === 'text') return { text: t.v };
      const pick = [t.id, ...(t.backups || [])].find((i) => byId.has(i) && can(i));
      if (!pick) {
        notes.push(`Left out: ${byId.get(t.id)?.said ?? 'a dish'} — none of its choices can be ordered`);
        return { gone: true, isDish: true };
      }
      if (pick !== t.id) notes.push(`${byId.get(t.id)?.said} can't be ordered → ${byId.get(pick)?.said}`);
      return { dish: pick === t.id && t.say ? t.say : byId.get(pick)!.said, swap: pick !== t.id, isDish: true };
    });
    const hadDish = parts.some((p) => p.isDish);
    parts.forEach((p, i) => {
      if (!p.gone) return;
      const prev = parts[i - 1], next = parts[i + 1];
      if (prev?.text != null && parts[i - 2]?.isDish && joiner(prev.text)) prev.text = ' ';
      else if (next?.text != null && parts[i + 2]?.isDish && joiner(next.text)) next.text = ' ';
    });
    const kept = parts.filter((p) => !p.gone);
    if (hadDish && !kept.some((p) => p.dish)) {
      notes.push('A sentence is skipped: none of its dishes can be ordered');
      continue;
    }
    if (kept.some((p) => p.dish || p.text?.trim())) out.push({ parts: kept });
  }
  return out;
}

/* ---------------------------------------------------------------- the sentence editor (one line) */

// A line is edited as text with pills inside it (contenteditable). The pills are <span>s that carry their dish:
// data-id (first choice), data-backups, data-say — read back into tokens on every change.
function pillHtml(t: Extract<NowAnswerToken, { t: 'dish' }>, byId: Map<string, Dish>) {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.tabIndex = 0;
  span.dataset.pill = '1';
  span.dataset.id = t.id;
  span.dataset.backups = (t.backups || []).join(',');
  span.dataset.say = t.say || '';
  dressPill(span, byId);
  return span;
}
function dressPill(span: HTMLElement, byId: Map<string, Dish>) {
  const d = byId.get(span.dataset.id || '');
  const n = (span.dataset.backups || '').split(',').filter(Boolean).length;
  const label = span.dataset.say || d?.said || 'Choose a dish';
  span.className =
    'mx-px inline-flex cursor-pointer select-none items-baseline gap-1 whitespace-nowrap rounded-md border px-2 font-semibold leading-relaxed ' +
    (d ? 'border-[#f6c2cd] bg-[#fde8ec] text-[#b3123a]' : 'border-dashed border-amber-500 bg-amber-50 text-amber-700');
  span.textContent = label;
  if (n) {
    const b = document.createElement('span');
    b.className = 'font-mono text-[11px] opacity-75';
    b.textContent = `+${n}`;
    span.append(b);
  }
  span.title = d ? `${d.name}${n ? ` · if sold out: ${(span.dataset.backups || '').split(',').filter(Boolean).map((i) => byId.get(i)?.name).join(', ')}` : ''}` : 'Choose a dish';
  span.setAttribute('aria-label', `Dish: ${label}, ${n} backup${n === 1 ? '' : 's'}. Press Enter to change.`);
}
function readLine(el: HTMLElement): Line {
  const toks: Line = [];
  const walk = (node: Node) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const v = (n.nodeValue || '').replace(/ /g, ' ');
        if (!v) return;
        const last = toks[toks.length - 1];
        if (last && last.t === 'text') last.v += v;
        else toks.push({ t: 'text', v });
      } else if (n instanceof HTMLElement) {
        if (n.dataset.pill) {
          if (n.dataset.id) {
            toks.push({ t: 'dish', id: n.dataset.id, backups: (n.dataset.backups || '').split(',').filter(Boolean), say: n.dataset.say || '' });
          }
        } else if (n.tagName !== 'BR') walk(n);
      }
    });
  };
  walk(el);
  return toks;
}

function LineEditor({ line, byId, onChange, onPill, registerInsert }: {
  line: Line;
  byId: Map<string, Dish>;
  onChange: (l: Line) => void;
  onPill: (span: HTMLElement) => void;
  registerInsert: (fn: () => void) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const range = useRef<Range | null>(null);
  // the DOM is built once from the line (and again only when the line is replaced from outside)
  const built = useRef<string>('');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = JSON.stringify(line);
    if (key === built.current || key === JSON.stringify(readLine(el))) {
      built.current = key;
      return;
    }
    el.innerHTML = '';
    for (const t of line) el.append(t.t === 'dish' ? pillHtml(t, byId) : document.createTextNode(t.v));
    built.current = key;
  }, [line, byId]);
  useEffect(() => {
    const keep = () => {
      const sel = window.getSelection();
      if (sel?.rangeCount && ref.current?.contains(sel.getRangeAt(0).startContainer)) range.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', keep);
    return () => document.removeEventListener('selectionchange', keep);
  }, []);
  // "+ Dish": a new pill where the cursor was in this line (or at its end), its editor open
  registerInsert(() => {
    const el = ref.current;
    if (!el) return;
    const span = pillHtml({ t: 'dish', id: '', backups: [], say: '' }, byId);
    const r = range.current && el.contains(range.current.startContainer) ? range.current : null;
    if (r) {
      r.deleteContents();
      r.insertNode(document.createTextNode(' '));
      r.insertNode(span);
      r.insertNode(document.createTextNode(' '));
    } else el.append(document.createTextNode(' '), span, document.createTextNode(' '));
    onPill(span);
  });
  const sync = () => {
    if (!ref.current) return;
    const l = readLine(ref.current);
    built.current = JSON.stringify(l);
    onChange(l);
  };
  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="false"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-ph="Type what the waiter says…"
      className="min-h-[36px] rounded-lg border border-transparent px-2 py-1 text-[16px] leading-[2] outline-none hover:border-[#ececec] focus:border-[#e2e2e2] focus:bg-[#fafafa] empty:before:text-slate-400 empty:before:content-[attr(data-ph)] [overflow-wrap:anywhere] whitespace-pre-wrap"
      onInput={sync}
      onKeyDown={(e) => {
        const pill = (e.target as HTMLElement).closest?.('[data-pill]') as HTMLElement | null;
        if (pill && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onPill(pill);
        } else if (e.key === 'Enter') e.preventDefault(); // (one sentence per line)
      }}
      onClick={(e) => {
        const pill = (e.target as HTMLElement).closest('[data-pill]') as HTMLElement | null;
        if (pill) onPill(pill);
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '));
      }}
    />
  );
}

/* ---------------------------------------------------------------- the pill's editor */

function DishSelect({ id, value, items, on, blank, onPick }: {
  id: string; value: string; items: Dish[]; on: Set<string>; blank: string; onPick: (v: string) => void;
}) {
  const groups = useMemo(() => {
    const g = new Map<string, Dish[]>();
    for (const it of items) g.set(it.category || 'Other', [...(g.get(it.category || 'Other') || []), it]);
    return [...g.entries()];
  }, [items]);
  return (
    <select id={id} value={value} onChange={(e) => onPick(e.target.value)}
      className="w-full min-w-0 rounded-md border border-[#e2e2e2] bg-white px-2 py-1.5 text-sm">
      <option value="">{blank}</option>
      {groups.map(([cat, its]) => (
        <optgroup key={cat} label={cat}>
          {its.map((it) => (
            <option key={it.id} value={it.id}>{`${it.name} ${money(it.price)}${on.has(it.id) ? '' : ' · not served then'}`}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function PillEditor({ span, items, byId, on, onDone, onChanged }: {
  span: HTMLElement; items: Dish[]; byId: Map<string, Dish>; on: Set<string>; onDone: () => void; onChanged: () => void;
}) {
  const [first, setFirst] = useState(span.dataset.id || '');
  const [b, setB] = useState(() => (span.dataset.backups || '').split(',').filter(Boolean));
  const [say, setSay] = useState(span.dataset.say || '');
  const box = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 16, top: 0 });
  useEffect(() => {
    const r = span.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? 360;
    setPos({ left: Math.max(16, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - w - 16)), top: r.bottom + window.scrollY + 8 });
    span.classList.add('ring-2', 'ring-[#b3123a]');
    return () => span.classList.remove('ring-2', 'ring-[#b3123a]');
  }, [span]);
  useEffect(() => {
    span.dataset.id = first;
    span.dataset.backups = b.filter((x, i, a) => x && x !== first && a.indexOf(x) === i).slice(0, 2).join(',');
    span.dataset.say = say.trim();
    dressPill(span, byId);
    onChanged();
  }, [first, b, say]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node) || span.contains(e.target as Node)) return;
      onDone();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [span, onDone]);
  const label = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500';
  return (
    <div ref={box} role="dialog" aria-label="Dish in this sentence" style={{ left: pos.left, top: pos.top }}
      className="fixed inset-x-0 bottom-0 z-40 grid gap-3 rounded-t-2xl border border-[#e5e5e5] bg-white p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:w-[360px] sm:rounded-xl">
      <div className="grid gap-1">
        <label htmlFor="pill-first" className={label}>First choice</label>
        <DishSelect id="pill-first" value={first} items={items} on={on} blank="Choose a dish…" onPick={setFirst} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="pill-b1" className={label}>If it can't be ordered, say</label>
        <DishSelect id="pill-b1" value={b[0] || ''} items={items} on={on} blank="No backup" onPick={(v) => setB([v, b[1] || ''])} />
        <DishSelect id="pill-b2" value={b[1] || ''} items={items} on={on} blank="No second backup" onPick={(v) => setB([b[0] || '', v])} />
        <p className="text-[12px] text-slate-500">The waiter uses the first one that can be ordered. If none can, it leaves the dish out of the sentence.</p>
      </div>
      <div className="grid gap-1">
        <label htmlFor="pill-say" className={label}>The waiter says it as</label>
        <input id="pill-say" value={say} maxLength={40} onChange={(e) => setSay(e.target.value)}
          placeholder={byId.get(first)?.said || "the dish's own name"} className="rounded-md border border-[#e2e2e2] px-2 py-1.5 text-sm" />
        <p className="text-[12px] text-slate-500">Leave it empty to say the dish's name. E.g. “ভাত” for সাদা ভাত (মিনিকেট).</p>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className="rounded-md px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
          onClick={() => { const line = span.parentElement; span.remove(); line?.dispatchEvent(new Event('input', { bubbles: true })); onDone(); }}>
          Remove from sentence
        </button>
        <button type="button" className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

export default function SettingsNowAnswers(): JSX.Element {
  const { token, getToken, refreshToken } = useAuthContext() as any;
  const { data: tenant, isLoading } = useTenant();
  const qc = useQueryClient();
  const sub = tenant?.subdomain;
  const base = useQuery<Suggested>({
    queryKey: ['now-answers', sub],
    enabled: !!sub,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await waiterFetch(`/now-answers?tenant=${encodeURIComponent(sub as string)}`, {}, { getToken, refreshToken });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'unavailable');
      return data as Suggested;
    },
  });
  const saved = (tenant as any)?.nowAnswers as Partial<Record<NowSlot, { lines: Line[] } | null>> | undefined;
  const [slot, setSlot] = useState<NowSlot>('lunch');
  const [draft, setDraft] = useState<Partial<Record<NowSlot, Line[]>>>({});
  const [sold, setSold] = useState<Set<string>>(new Set());
  const [pill, setPillEl] = useState<HTMLElement | null>(null);
  const [pillKey, setPillKey] = useState(0); // (one editor per opened pill — never remounted while it's being edited)
  const setPill = (el: HTMLElement | null) => { setPillEl(el); if (el) setPillKey((k) => k + 1); };
  const [tick, setTick] = useState(0); // (a pill changed in place → the preview again)
  const [saving, setSaving] = useState(false);
  const inserts = useRef<Record<number, () => void>>({});

  const items = base.data?.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const ownOf = (s: NowSlot): Line[] => saved?.[s]?.lines ?? base.data?.suggested[s] ?? [];
  const lines: Line[] = draft[slot] ?? ownOf(slot);
  const on = useMemo(() => new Set(base.data?.on[slot] ?? []), [base.data, slot]);
  const dirty = (['morning', 'lunch', 'evening', 'night'] as NowSlot[]).filter((s) => draft[s] && !same(draft[s], ownOf(s)));

  const setLines = (next: Line[]) => setDraft((d) => ({ ...d, [slot]: next }));
  const readAll = (): Line[] => {
    const els = [...document.querySelectorAll<HTMLElement>('[data-now-line]')];
    return els.map((el) => readLine(el));
  };

  const { heard, notes } = useMemo(() => {
    const n: string[] = [];
    return { heard: hear(lines, byId, (i) => on.has(i) && !sold.has(i), n), notes: [...new Set(n)] };
  }, [lines, byId, on, sold, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const used = useMemo(() => {
    const u: string[] = [];
    for (const l of lines) for (const t of l) if (t.t === 'dish') for (const i of [t.id, ...(t.backups || [])]) if (i && !u.includes(i)) u.push(i);
    return u;
  }, [lines]);

  const save = async () => {
    if (!token || !dirty.length) return;
    setSaving(true);
    try {
      const payload: Partial<Record<NowSlot, { lines: Line[] } | null>> = {};
      for (const s of dirty) payload[s] = { lines: (draft[s] || []).map((l) => l.filter((t) => t.t === 'dish' ? !!t.id : true)) };
      await updateTenant({ nowAnswers: payload }, token);
      await qc.invalidateQueries({ queryKey: ['tenant', token] });
      setDraft({});
      toastSuccess('Saved — the waiter says it from now on');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };
  const useOwn = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await updateTenant({ nowAnswers: { [slot]: null } }, token);
      await qc.invalidateQueries({ queryKey: ['tenant', token] });
      setDraft((d) => ({ ...d, [slot]: undefined }));
      toastSuccess(`${SLOT_LABEL[slot]}: the waiter's own answer again`);
    } catch {
      toastError('Could not reset it');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || base.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2e2e30] border-t-transparent" />
      </div>
    );
  }
  if (base.isError || !base.data) {
    return <div className={`${card} p-4 text-sm text-slate-600`}>The waiter couldn't load your menu just now. Please try again in a moment.</div>;
  }
  const slots = base.data.slots;
  const cur = slots.find((s) => s.key === slot)!;
  const custom = (s: NowSlot) => !!saved?.[s]?.lines?.length;

  return (
    <div className="grid gap-4">
      <div className={`${card} p-4`}>
        <div className="text-[14px] font-semibold text-slate-900">What to eat now</div>
        <p className="mt-0.5 max-w-[68ch] text-[12.5px] text-slate-500">
          What your AI waiter says when a guest asks what there is to eat — one answer for each time of day. Write it the way your waiter speaks;
          each dish is a pill with backups for when it's sold out. A time you leave alone keeps the waiter's own answer.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Questions it answers">
          {QUESTIONS.map((q) => <span key={q} className="rounded-full border border-[#ececec] px-2.5 py-0.5 text-[12.5px] text-slate-600">{q}</span>)}
        </div>
      </div>

      <div role="tablist" aria-label="Time of day" className="flex gap-1 overflow-x-auto border-b border-[#ececec]">
        {slots.map((s) => (
          <button key={s.key} role="tab" type="button" aria-selected={slot === s.key}
            onClick={() => { setPill(null); setSlot(s.key); }}
            className={`-mb-px grid whitespace-nowrap border-b-2 px-3.5 pb-2.5 pt-2 text-left ${slot === s.key ? 'border-[#2e2e30]' : 'border-transparent'}`}>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              {SLOT_LABEL[s.key]}
              {dirty.includes(s.key) ? <span className="rounded bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-700">Unsaved</span>
                : custom(s.key) ? <span className="rounded bg-[#fde8ec] px-1.5 text-[10.5px] font-semibold text-[#b3123a]">Yours</span> : null}
            </span>
            <span className="font-mono text-[11px] text-slate-400">{clock(s.from)} – {clock(s.to)}</span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className={card} aria-label="Sentences">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ececec] px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">{custom(slot) || draft[slot] ? 'Your answer' : "The waiter's own answer — edit it to make it yours"}</div>
            <div className="text-[12px] text-slate-500">Click a pill to change the dish · <b>+ Dish</b> adds one where your cursor is</div>
          </div>
          {lines.length === 0 && <div className="px-4 py-4 text-sm text-slate-500">No sentences yet — add one below, then type and add dishes.</div>}
          {lines.map((line, i) => (
            <div key={`${slot}-${i}-${lines.length}`} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 border-b border-[#f1f1f1] px-4 py-3 last:border-b-0">
              <div className="pt-1.5 text-right font-mono text-[12px] text-slate-400">{i + 1}</div>
              <div data-now-line-wrap>
                <div data-now-line="" className="contents">
                  <LineEditor
                    line={line}
                    byId={byId}
                    onChange={(l) => setLines(lines.map((x, j) => (j === i ? l : x)))}
                    onPill={(span) => setPill(span)}
                    registerInsert={(fn) => { inserts.current[i] = fn; }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => inserts.current[i]?.()}
                    className="inline-flex items-center gap-1 rounded-md border border-[#f6c2cd] bg-[#fde8ec] px-2.5 py-0.5 text-[12.5px] font-medium text-[#b3123a]">
                    <PlusIcon className="h-3.5 w-3.5" /> Dish
                  </button>
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setLines(lines.map((x, j) => (j === i - 1 ? lines[i] : j === i ? lines[i - 1] : x)))}
                    className="rounded-md border border-[#e5e5e5] px-1.5 py-0.5 text-slate-600 disabled:opacity-30"><ArrowUpIcon className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Move down" disabled={i === lines.length - 1} onClick={() => setLines(lines.map((x, j) => (j === i + 1 ? lines[i] : j === i ? lines[i + 1] : x)))}
                    className="rounded-md border border-[#e5e5e5] px-1.5 py-0.5 text-slate-600 disabled:opacity-30"><ArrowDownIcon className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] px-2 py-0.5 text-[12.5px] text-red-700"><TrashIcon className="h-3.5 w-3.5" /> Delete sentence</button>
                </div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap justify-between gap-2 border-t border-[#ececec] px-4 py-3">
            <span className="flex flex-wrap gap-2">
              <button type="button" className="rounded-md border border-[#e5e5e5] px-3 py-1.5 text-sm" onClick={() => setLines([...lines, []])}>+ Add sentence</button>
              <button type="button" className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setLines([[]])}>Start over</button>
            </span>
            <span className="flex flex-wrap gap-2">
              {custom(slot) && (
                <button type="button" disabled={saving} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50" onClick={() => void useOwn()}>
                  Use the waiter's own
                </button>
              )}
              {draft[slot] && (
                <button type="button" className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setDraft((d) => ({ ...d, [slot]: undefined }))}>
                  Discard changes
                </button>
              )}
              <button type="button" disabled={saving || !dirty.length} onClick={() => void save()}
                className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                {saving ? 'Saving…' : dirty.length > 1 ? `Save ${dirty.length} times of day` : 'Save'}
              </button>
            </span>
          </div>
        </section>

        <aside className={card} aria-label="What the guest hears">
          <div className="flex items-center justify-between gap-2 border-b border-[#ececec] px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">What the guest hears</div>
            <div className="text-[12px] text-slate-500">{SLOT_LABEL[slot]} · e.g. {clock(cur.sampleAt)}</div>
          </div>
          <div className="grid gap-3 p-4">
            <div aria-live="polite" className="rounded-2xl rounded-bl-sm border border-[#ececec] bg-[#fafafa] px-3.5 py-3 text-[16px] leading-relaxed">
              {heard.length ? heard.map((s, k) => (
                <span key={k}>{s.parts.map((p, j) => p.dish
                  ? <b key={j} className={p.swap ? 'rounded bg-emerald-50 px-1 text-emerald-800' : ''}>{p.dish}</b>
                  : <span key={j}>{p.text}</span>)}{' '}</span>
              )) : <span className="text-slate-400">Nothing to say yet — add a sentence.</span>}
            </div>
            {notes.length > 0 && <ul className="grid gap-0.5 text-[12.5px] text-slate-600">{notes.map((n, k) => <li key={k}>{n}</li>)}</ul>}
          </div>
          <div className="grid gap-2 border-t border-[#ececec] px-4 py-3">
            <div className="text-[12.5px] font-semibold text-slate-600">Try it: mark dishes sold out (only here, not on your menu)</div>
            <div className="flex flex-wrap gap-1.5">
              {used.length ? used.map((id) => (
                <label key={id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#e5e5e5] py-0.5 pl-1.5 pr-2.5 text-[13px] ${sold.has(id) ? 'bg-slate-100 text-slate-400 line-through' : ''}`}>
                  <input type="checkbox" checked={sold.has(id)} onChange={() => setSold((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
                  {byId.get(id)?.said ?? id}
                </label>
              )) : <span className="text-[13px] text-slate-400">The dishes you add show here.</span>}
            </div>
          </div>
        </aside>
      </div>

      {pill && (
        <PillEditor
          key={pillKey}
          span={pill}
          items={items}
          byId={byId}
          on={on}
          onChanged={() => { const all = readAll(); setLines(all); setTick((t) => t + 1); }}
          onDone={() => { setPill(null); setLines(readAll()); }}
        />
      )}
    </div>
  );
}
