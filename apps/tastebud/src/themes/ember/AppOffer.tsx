// apps/tastebud/src/themes/ember/AppOffer.tsx — "Get the Burger House app", on the order page at the right moment:
// a dine-in order once it's served (the meal is over), an online order once it's placed. Never while ordering; never
// when it's already installed or open as the app; "not now" puts it away for a month. Android with Chrome's offer:
// one tap brings up Android's own install box. Everything else: the install page (/app), which shows that phone's way.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '../../utils/track';
import { appIconHref, installHref, installedBefore, promptInstall, siteBase, thisPhone, useInstall } from '../../pwa/pwa';
import { branchOfPath } from '../../pwa/AppHead';
import { EM, tx, type Lang } from './ui';

const LATER_MS = 30 * 24 * 60 * 60 * 1000;

export default function AppOffer({ sub, name, lang, show }: { sub: string; name: string; lang: Lang; show: boolean }) {
  const navigate = useNavigate();
  const key = `qravy:app:later:${sub}`;
  const [later, setLater] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(key) || 0) < LATER_MS;
    } catch {
      return false;
    }
  });
  const { canPrompt, installedNow } = useInstall();
  const phone = thisPhone();
  if (!show || later || installedNow || phone.standalone || phone.os === 'desktop' || installedBefore()) return null;
  const base = siteBase(location.pathname);
  const branch = branchOfPath(location.pathname);
  const kind = phone.os;
  const install = async () => {
    track('app_install_offered', { data: { source: 'offer', kind } });
    if (phone.os === 'android' && canPrompt && !phone.inApp) {
      await promptInstall();
      return;
    }
    navigate(`${installHref(base, branch)}?src=offer`);
  };
  const notNow = () => {
    setLater(true);
    try {
      localStorage.setItem(key, String(Date.now()));
    } catch {
      /* storage blocked */
    }
  };
  return (
    <div className="em-rise flex flex-col gap-3 rounded-[18px] p-4" style={{ background: EM.amberTint, border: `1px solid ${EM.amberLine}` }}>
      <div className="flex items-center gap-3">
        <img src={appIconHref(sub, 192)} alt="" className="h-12 w-12 shrink-0 rounded-[14px]" />
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{tx(lang, `${name} অ্যাপ`, `The ${name} app`)}</div>
          <div className="text-[13px]" style={{ color: EM.text3 }}>
            {tx(lang, 'পরের বার ডেলিভারি অর্ডার এক ট্যাপে', 'Order delivery in one tap next time')}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void install()} className="h-11 flex-1 rounded-full text-[14px] font-bold" style={{ background: EM.amber, color: EM.bg }}>
          {phone.os === 'ios' ? tx(lang, 'হোম স্ক্রিনে যোগ করুন', 'Add to Home Screen') : tx(lang, 'অ্যাপ ইনস্টল করুন', 'Install the app')}
        </button>
        <button type="button" onClick={notNow} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: EM.surface2, color: EM.text }}>
          {tx(lang, 'এখন না', 'Not now')}
        </button>
      </div>
    </div>
  );
}
