// apps/tastebud/src/themes/ember/ModeSheet.tsx
// 9.3 — online: "How do you want your order?" Delivery or Pickup. Choosing applies at once (the same remembered
// choice the checkout and the waiter use — utils/order-mode).
import { usePickupPlace, type Fulfillment } from '../../utils/order-mode';
import { EM, I, Sheet, tx, type Lang } from './ui';

export default function ModeSheet({
  open,
  onClose,
  mode,
  onMode,
  sub,
  branch,
  lang,
}: {
  open: boolean;
  onClose: () => void;
  mode: Fulfillment;
  onMode: (m: Fulfillment) => void;
  sub: string;
  branch: string | null;
  lang: Lang;
}) {
  const place = usePickupPlace(sub, branch);
  const option = (m: Fulfillment, icon: React.ReactNode, title: string, sub2: string) => {
    const on = mode === m;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => {
          onMode(m);
          onClose();
        }}
        className="flex items-center gap-3.5 rounded-2xl p-4 text-left"
        style={{ border: on ? `1.5px solid ${EM.amber}` : `1px solid ${EM.border}`, background: '#1E1E21', color: EM.text }}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: '#2A2418', color: EM.amber }}>
          {icon}
        </span>
        <span className="flex flex-1 flex-col gap-[3px]">
          <span className="text-[17px] font-semibold">{title}</span>
          <span className="text-[13px] leading-[1.4]" style={{ color: EM.text3 }}>{sub2}</span>
        </span>
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
          style={{ border: `2px solid ${on ? EM.amber : '#48484D'}` }}
        >
          {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: EM.amber }} />}
        </span>
      </button>
    );
  };
  return (
    <Sheet open={open} onClose={onClose} label={tx(lang, 'ডেলিভারি না পিকআপ', 'Choose delivery or pickup')} bg="#17171A">
      <div role="radiogroup" className="flex flex-col gap-3.5">
        <span className="em-tight text-[22px] font-semibold">{tx(lang, 'অর্ডার কীভাবে নেবেন?', 'How do you want your order?')}</span>
        {option('delivery', I.bike({ size: 20 }), tx(lang, 'ডেলিভারি', 'Delivery'), tx(lang, 'আপনার ঠিকানায় পৌঁছে দেওয়া হবে', 'Brought to your door'))}
        {option(
          'pickup',
          I.bag({ size: 20 }),
          tx(lang, 'পিকআপ', 'Pickup'),
          [tx(lang, 'রেস্টুরেন্ট থেকে নিয়ে যান', 'Collect it from the restaurant'), place.address].filter(Boolean).join(' · '),
        )}
        <p className="text-[13px] leading-[1.45]" style={{ color: EM.text3 }}>
          {tx(
            lang,
            'ডেলিভারি আর পিকআপে মেনু ও দাম আলাদা হতে পারে। অর্ডারের কিছু না পাওয়া গেলে বাদ দেওয়ার আগে জিজ্ঞেস করা হবে।',
            'The menu and prices can change between delivery and pickup. If something in your order isn’t available, we’ll ask before removing it.',
          )}
        </p>
      </div>
    </Sheet>
  );
}
