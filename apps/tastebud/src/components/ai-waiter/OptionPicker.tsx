// apps/tastebud/src/components/ai-waiter/OptionPicker.tsx
// A dish the waiter is holding until the guest picks its size / required choices ("2 × Hot Wings — which size, how
// spicy?"). It sits at the top of the tray like a line that isn't in yet (the customise-item pattern of delivery
// apps, inline instead of a sheet so the waiter's orb below stays usable): tap the chips OR just say it — both land
// in the same held order. The last missing pick adds it, with the quantity the guest ordered.
import React from 'react';
import type { PickOption } from '../../utils/handsfree';
import { tr } from '../../utils/ui-lang';

type Props = {
  picks: PickOption[];
  lang: 'bn' | 'en';
  imageFor?: (itemId: string) => string | undefined;
  /** sends the guest's answer as their words (the waiter adds it and confirms) */
  onAnswer: (say: string) => void;
};

const BDT = new Intl.NumberFormat('en-BD');
const money = (n: number) => `৳${BDT.format(n)}`;

type Sel = { variant: string; choices: string[] };

function gaps(p: PickOption, s: Sel): string[] {
  const out: string[] = [];
  if (p.sizes.length > 1 && !s.variant) out.push('size');
  for (const g of p.groups) {
    const have = g.options.filter((o) => s.choices.includes(o.name)).length;
    if (have < g.min) out.push(g.name);
  }
  return out;
}

function sayFor(p: PickOption, s: Sel, lang: 'bn' | 'en'): string {
  const parts = [s.variant, ...s.choices].filter(Boolean).join(', ');
  return lang === 'en' ? `${p.quantity} ${p.name} — ${parts}, please` : `${p.quantity}টা ${p.name} — ${parts} দিন`;
}

function unitPrice(p: PickOption, s: Sel): number | null {
  const size = p.sizes.find((v) => v.name === s.variant) ?? (p.sizes.length === 1 ? p.sizes[0] : undefined);
  if (p.sizes.length > 1 && !size) return null;
  const extra = p.groups.flatMap((g) => g.options).filter((o) => s.choices.includes(o.name)).reduce((n, o) => n + (o.price || 0), 0);
  return typeof size?.price === 'number' ? size.price + extra : null;
}

function Chip({ on, label, price, hint, onClick }: { on: boolean; label: string; price?: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={
        'flex flex-col items-center rounded-full px-3.5 py-2 text-[13px] font-semibold transition active:scale-95 ' +
        (hint ? 'rounded-2xl ' : '') +
        (on ? 'bg-[#FA2851] text-white shadow-sm shadow-rose-200' : 'bg-white text-gray-800 ring-1 ring-gray-200 hover:ring-[#FA2851]/40')
      }
    >
      <span>
        {label}
        {price && <span className={'ml-1.5 font-normal ' + (on ? 'text-white/85' : 'text-gray-500')}>{price}</span>}
      </span>
      {/* the size-up: what the bigger size gets you — a hint, never a question */}
      {hint && <span className={'mt-0.5 text-[10.5px] font-medium ' + (on ? 'text-white/85' : 'text-emerald-600')}>{hint}</span>}
    </button>
  );
}

function Section({ title, need, done, children }: { title: string; need: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-gray-900">{title}</span>
        {done ? (
          <span className="text-[11px] font-semibold text-emerald-600">✓</span>
        ) : (
          <span className="rounded-full bg-[#FA2851]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#FA2851]">{need}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function PickCard({ p, lang, image, onAnswer }: { p: PickOption; lang: 'bn' | 'en'; image?: string; onAnswer: (say: string) => void }) {
  const fromServer: Sel = { variant: p.variant, choices: p.choices };
  const [sel, setSel] = React.useState<Sel>(fromServer);
  const [sending, setSending] = React.useState(false);
  const sentRef = React.useRef(false);

  // the waiter's reading changed (the guest said part of it) → take it, keeping taps it hasn't heard yet
  const serverKey = `${p.variant}|${p.choices.join(',')}|${p.missing.join(',')}`;
  React.useEffect(() => {
    setSel((local) => {
      const variant = p.variant || local.variant;
      const choices = [...p.choices];
      for (const g of p.groups) {
        if (!p.missing.includes(g.name)) continue;
        for (const c of local.choices) if (g.options.some((o) => o.name === c) && !choices.includes(c)) choices.push(c);
      }
      return { variant, choices };
    });
    setSending(false);
    sentRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  // everything picked → send it once (a short beat so the guest sees the chip light up)
  const missing = gaps(p, sel);
  React.useEffect(() => {
    if (missing.length || sentRef.current) return;
    sentRef.current = true;
    setSending(true);
    const t = window.setTimeout(() => onAnswer(sayFor(p, sel, lang)), 280);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.length]);

  const toggle = (g: PickOption['groups'][number], name: string) =>
    setSel((s) => {
      const inGroup = g.options.map((o) => o.name);
      if (s.choices.includes(name)) return { ...s, choices: s.choices.filter((c) => c !== name) };
      const max = g.max || inGroup.length;
      // one pick (spice level) → swap it; several → add up to the limit
      if (max === 1) return { ...s, choices: [...s.choices.filter((c) => !inGroup.includes(c)), name] };
      if (s.choices.filter((c) => inGroup.includes(c)).length >= max) return s;
      return { ...s, choices: [...s.choices, name] };
    });

  const unit = unitPrice(p, sel);
  const required = p.groups.filter((g) => g.min > 0);

  return (
    <div className="rounded-2xl border-2 border-dashed border-[#FA2851]/35 bg-[#FA2851]/[0.03] p-3">
      <div className="flex items-center gap-3">
        {image ? (
          <img src={image} alt="" className="h-12 w-12 rounded-xl object-cover" />
        ) : (
          <div className="h-12 w-12 rounded-xl bg-gray-100" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium text-gray-900">
            <span className="text-[#FA2851]">{p.quantity}×</span> {p.name}
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-gray-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FA2851]/50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FA2851]" />
            </span>
            {sending
              ? tr(lang, 'যোগ করা হচ্ছে…', 'Adding…')
              : tr(lang, 'বেছে নিন — ট্যাপ করুন বা বলুন', 'Pick below — tap or just say it')}
          </div>
        </div>
        {unit !== null && <div className="shrink-0 text-[14px] font-semibold text-gray-900">{money(unit * p.quantity)}</div>}
      </div>

      {p.sizes.length > 1 && (
        <Section title={tr(lang, 'সাইজ', 'Size')} need={tr(lang, 'বাধ্যতামূলক', 'Required')} done={!!sel.variant}>
          {p.sizes.map((s) => (
            <Chip
              key={s.name}
              on={sel.variant === s.name}
              label={s.name}
              price={typeof s.price === 'number' ? money(s.price) : undefined}
              hint={p.sizeHints[s.name]}
              onClick={() => setSel((x) => ({ ...x, variant: s.name }))}
            />
          ))}
        </Section>
      )}
      {required.map((g) => {
        const have = g.options.filter((o) => sel.choices.includes(o.name)).length;
        const need = g.min > 1 ? tr(lang, `যেকোনো ${g.min}টা`, `Pick ${g.min}`) : tr(lang, 'বাধ্যতামূলক', 'Required');
        return (
          <Section key={g.name} title={g.name} need={need} done={have >= g.min}>
            {g.options.map((o) => (
              <Chip
                key={o.name}
                on={sel.choices.includes(o.name)}
                label={o.name}
                price={o.price > 0 ? `+${money(o.price)}` : undefined}
                onClick={() => toggle(g, o.name)}
              />
            ))}
          </Section>
        );
      })}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => onAnswer(lang === 'en' ? 'No, leave it' : 'না, থাক')}
          className="text-[12px] font-medium text-gray-500 hover:text-gray-800"
        >
          {tr(lang, 'বাদ দিন', 'Skip this')}
        </button>
      </div>
    </div>
  );
}

export default function OptionPicker({ picks, lang, imageFor, onAnswer }: Props) {
  if (!picks.length) return null;
  return (
    <section aria-label={tr(lang, 'আপনার পছন্দ বাকি', 'Needs your choice')} className="space-y-3">
      {picks.map((p) => (
        <PickCard key={p.itemId} p={p} lang={lang} image={imageFor?.(p.itemId)} onAnswer={onAnswer} />
      ))}
    </section>
  );
}
