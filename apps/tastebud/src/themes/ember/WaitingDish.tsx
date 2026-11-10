// apps/tastebud/src/themes/ember/WaitingDish.tsx
// A dish the waiter is holding until the guest picks its size / required choices — shown INSIDE "Your order" as a
// row that isn't in yet: its photo and name, then its sizes and choices as pills (tap them, or just say it). The
// same rules as the original theme's option card (components/ai-waiter/OptionPicker): picks stay on the phone until
// everything needed is chosen, then ONE answer goes to the waiter ("1টা Hot Wings — 10 pcs, Extra hot দিন"), which
// adds it and confirms. What the guest SAYS is taken in too (the waiter's reading arrives as the dish's new state).
import React from 'react';
import type { PickOption } from '../../utils/handsfree';
import { gaps, sayFor, unitPrice, type Sel } from '../../components/ai-waiter/OptionPicker';
import { money } from '../../utils/ui-lang';
import { EM, I, tx, type Lang } from './ui';

function Pill({ on, label, sub, onClick }: { on: boolean; label: string; sub?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition active:scale-95"
      style={
        on
          ? { background: EM.amber, color: EM.bg, fontWeight: 700, paddingLeft: 10 }
          : { border: `1px solid ${EM.chipLine}`, background: EM.chip, color: EM.text, fontWeight: 500 }
      }
    >
      {on && I.check({ size: 14, sw: 3 })}
      {label}
      {sub && <span style={{ color: on ? 'rgba(11,11,12,0.7)' : EM.text3, fontWeight: 500 }}>· {sub}</span>}
    </button>
  );
}

function Group({ title, need, done, children }: { title: string; need: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold tracking-[0.8px]" style={{ color: need && !done ? EM.amber : EM.text3 }}>
        {title}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function WaitingDish({ p, lang, image, onAnswer }: { p: PickOption; lang: Lang; image?: string; onAnswer: (say: string) => void }) {
  const [sel, setSel] = React.useState<Sel>({ variant: p.variant, choices: p.choices });
  const [sending, setSending] = React.useState(false);
  const sentRef = React.useRef(false);

  // the waiter's reading changed (the guest SAID part of it) → take it, keeping taps it hasn't heard yet
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

  // everything picked → one answer to the waiter (a short beat so the guest sees the pill light up)
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
      if (max === 1) return { ...s, choices: [...s.choices.filter((c) => !inGroup.includes(c)), name] };
      if (s.choices.filter((c) => inGroup.includes(c)).length >= max) return s;
      return { ...s, choices: [...s.choices, name] };
    });

  const unit = unitPrice(p, sel);
  const required = p.groups.filter((g) => g.min > 0);
  const picked = [sel.variant, ...sel.choices].filter(Boolean).join(', ');
  const anyPicked = !!picked;
  const status = sending
    ? tx(lang, 'যোগ করা হচ্ছে…', 'Adding…')
    : missing.length === 1 && missing[0] === 'size' && anyPicked
    ? tx(lang, 'আর শুধু সাইজটা', 'Just the size now')
    : missing.length === 1 && anyPicked
    ? tx(lang, `আর শুধু ${missing[0]}`, `Just the ${missing[0]} now`)
    : p.sizes.length > 1 && required.length
    ? tx(lang, 'সাইজ আর পছন্দ বেছে নিন — ট্যাপ করুন বা বলুন', 'Pick a size and choice — tap or just say it')
    : tx(lang, 'বেছে নিন — ট্যাপ করুন বা বলুন', 'Pick below — tap or just say it');

  return (
    <div
      className="em-fade -mx-2 flex flex-col gap-3 rounded-2xl p-3 transition-colors"
      style={{ background: EM.amberTint, border: `1.5px solid ${anyPicked ? EM.amber : EM.amberLine}` }}
    >
      <div className="flex items-center gap-3">
        {image ? (
          <img src={image} alt="" className="h-[52px] w-[52px] shrink-0 rounded-xl object-cover" />
        ) : (
          <div aria-hidden="true" className="h-[52px] w-[52px] shrink-0 rounded-xl" style={{ background: '#2A1F12' }} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-[15px] font-semibold">
            {p.quantity} × {p.name}
            {picked && <span style={{ color: EM.text3, fontWeight: 400 }}> · {picked}</span>}
          </span>
          <span className="text-[12px] font-semibold" style={{ color: EM.amber }}>{status}</span>
        </div>
        {unit !== null ? (
          <span className="shrink-0 text-[14px] font-semibold" style={{ color: EM.text2 }}>{money(unit * p.quantity)}</span>
        ) : (
          <button
            type="button"
            aria-label={tx(lang, `${p.name} বাদ দিন`, `Skip the ${p.name}`)}
            onClick={() => onAnswer(lang === 'en' ? 'No, leave it' : 'না, থাক')}
            className="flex h-11 w-9 shrink-0 items-center justify-center"
            style={{ color: EM.muted }}
          >
            {I.x()}
          </button>
        )}
      </div>

      {p.sizes.length > 1 && (
        <Group title={tx(lang, 'সাইজ', 'SIZE')} need done={!!sel.variant}>
          {p.sizes.map((s) => (
            <Pill
              key={s.name}
              on={sel.variant === s.name}
              label={s.name}
              sub={typeof s.price === 'number' ? money(s.price) : undefined}
              onClick={() => setSel((x) => ({ ...x, variant: s.name }))}
            />
          ))}
        </Group>
      )}
      {required.map((g) => {
        const have = g.options.filter((o) => sel.choices.includes(o.name)).length;
        return (
          <Group key={g.name} title={g.name} need done={have >= g.min}>
            {g.options.map((o) => (
              <Pill
                key={o.name}
                on={sel.choices.includes(o.name)}
                label={o.name}
                sub={o.price > 0 ? `+${money(o.price)}` : undefined}
                onClick={() => toggle(g, o.name)}
              />
            ))}
          </Group>
        );
      })}
    </div>
  );
}
