/**
 * Settings → Localization → Virtual waiter language: the language the waiter speaks by default.
 * Guests can still switch it from the top-right corner of the storefront.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LanguageIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { toastError, toastSuccess } from '../Toaster';

type Lang = 'bn' | 'en';

const OPTIONS: Array<{ value: Lang; label: string; hint: string }> = [
  { value: 'bn', label: 'বাংলা', hint: 'Bangla' },
  { value: 'en', label: 'English', hint: 'English' },
];

export default function WaiterLanguageCard() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: tenant, isLoading } = useTenant();
  const saved: Lang = tenant?.waiterLanguage === 'en' ? 'en' : 'bn';
  const [saving, setSaving] = useState<Lang | null>(null);

  const choose = async (lang: Lang) => {
    if (lang === saved || saving) return;
    setSaving(lang);
    try {
      await updateTenant({ waiterLanguage: lang }, token as string);
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess(`Virtual waiter now speaks ${lang === 'bn' ? 'Bangla' : 'English'} by default`);
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the waiter language');
    } finally {
      setSaving(null);
    }
  };

  const active = saving ?? saved;

  return (
    <div id="waiter-language" className="scroll-mt-20 rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
        <LanguageIcon className="h-4 w-4 text-slate-500" aria-hidden="true" />
        Virtual waiter language
      </div>
      <p className="mt-1 text-[12px] text-slate-500">
        The language your virtual waiter listens and replies in. Guests can switch it any time from the top-right
        corner of your menu.
      </p>

      <div
        role="radiogroup"
        aria-label="Virtual waiter language"
        className="mt-4 inline-flex rounded-lg border border-[#e2e2e2] bg-slate-50 p-1"
      >
        {OPTIONS.map((o) => {
          const on = active === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={isLoading || !!saving}
              onClick={() => choose(o.value)}
              title={o.hint}
              className={`min-w-[96px] rounded-md px-4 py-1.5 text-sm transition-colors disabled:cursor-wait ${
                on ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
