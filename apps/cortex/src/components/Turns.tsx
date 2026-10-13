// apps/cortex/src/components/Turns.tsx — the AI waiter's turns, each as heard → understood → said.
import type { Turn } from '../api';
import { Badge, fmt } from './ui';

export default function Turns({ turns }: { turns: Turn[] }) {
  if (!turns.length) return <p className="text-[13px] text-stone-500">The guest didn&apos;t talk to the AI waiter.</p>;
  return (
    <ol className="space-y-3">
      {turns.map((t, i) => (
        <li key={i} className="rounded-lg border border-stone-200 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
            <span>{fmt.time(t.at)}</span>
            <Badge>{t.input}</Badge>
            {t.understood.language && <Badge>{t.understood.language}</Badge>}
            {t.understood.intent && <Badge tone="info">{t.understood.intent}</Badge>}
            {t.unheard && <Badge tone="warn">not heard</Badge>}
            {t.understood.orderPlaced && <Badge tone="good">order #{t.understood.orderNumber ?? ''} placed</Badge>}
            {t.understood.upsellOffer && <Badge tone="info">offered: {t.understood.upsellOffer}</Badge>}
            {t.flags.map((f) => (
              <Badge key={f} tone="warn">{f}</Badge>
            ))}
          </div>
          <dl className="grid gap-2 text-[13px] md:grid-cols-[110px_1fr]">
            <dt className="text-stone-500">Heard</dt>
            <dd className="text-stone-900">{t.heard || <span className="italic text-stone-400">(nothing)</span>}</dd>
            {(t.understood.text || t.understood.corrections.length > 0) && (
              <>
                <dt className="text-stone-500">Cleaned up</dt>
                <dd className="text-stone-700">
                  {t.understood.text}
                  {t.understood.corrections.map((c, j) => (
                    <span key={j} className="ml-2 text-[12px] text-stone-500">
                      {c.from} → {c.to}
                    </span>
                  ))}
                </dd>
              </>
            )}
            {(t.understood.actions.length > 0 || t.understood.mentioned.length > 0 || t.understood.suggested.length > 0) && (
              <>
                <dt className="text-stone-500">Understood</dt>
                <dd className="space-y-0.5 text-stone-700">
                  {t.understood.actions.map((a, j) => (
                    <div key={j}>
                      • {a.op} {a.quantity ? `${a.quantity} × ` : ''}
                      {a.name ?? ''}
                      {a.variant ? ` (${a.variant})` : ''}
                    </div>
                  ))}
                  {t.understood.mentioned.length > 0 && <div>About: {t.understood.mentioned.join(', ')}</div>}
                  {t.understood.suggested.length > 0 && <div>Suggested: {t.understood.suggested.join(', ')}</div>}
                </dd>
              </>
            )}
            <dt className="text-stone-500">Said</dt>
            <dd className="text-stone-900">{t.said}</dd>
          </dl>
        </li>
      ))}
    </ol>
  );
}
