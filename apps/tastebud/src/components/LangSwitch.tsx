// apps/tastebud/src/components/LangSwitch.tsx
// Minimal Bangla / English switch for the virtual waiter (top-right of the waiter and menu screens).
import type { WaiterLang } from '../utils/waiter-lang';

const OPTIONS: Array<{ value: WaiterLang; label: string; name: string }> = [
  { value: 'bn', label: 'বাং', name: 'বাংলা' },
  { value: 'en', label: 'EN', name: 'English' },
];

export default function LangSwitch({
  value,
  onChange,
  className = '',
}: {
  value: WaiterLang;
  onChange: (lang: WaiterLang) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={value === 'bn' ? 'ওয়েটারের ভাষা' : 'Waiter language'}
      className={`inline-flex items-center rounded-full border border-gray-200 bg-white/90 p-0.5 shadow-sm backdrop-blur ${className}`}
    >
      {OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.name}
            onClick={() => !on && onChange(o.value)}
            className={`h-8 min-w-[40px] rounded-full px-2.5 text-[13px] leading-none transition-colors ${
              on ? 'bg-gray-900 font-semibold text-white' : 'text-gray-600 hover:text-gray-900'
            }`}
            style={o.value === 'bn' ? { fontFamily: `'Noto Sans Bengali', system-ui, sans-serif` } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
