// apps/tastebud/src/components/BranchGate.tsx
// A restaurant with two or more branches takes every order for one branch. Its branch links go straight in
// ("burger-house.qravy.com/gulshan", "…/gulshan/dine-in?table=12"); the main link ("burger-house.qravy.com", or an
// old table code without a branch) asks "Which branch?" first, then opens the same page for that branch — the table
// and its QR key come along. A branch link that isn't one of its open branches asks again.
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { splitStorePath, storeBranchFromPath, storeSubFromPath } from '../utils/table';
import { useStoreChannels, type StoreBranch } from '../utils/order-mode';
import { tr, uiLang } from '../utils/ui-lang';

export default function BranchGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const sub = storeSubFromPath(pathname);
  const branch = storeBranchFromPath(pathname);
  const { branches, loaded } = useStoreChannels(sub);

  if (!sub) return <>{children}</>;
  if (!loaded) return null; // a moment — whether to ask depends on the restaurant's branches
  if (branches.length < 2) return <>{children}</>;
  if (branch && branches.some((b) => b.slug === branch)) return <>{children}</>;
  return <AskBranch branches={branches} current={branch} />;
}

function AskBranch({ branches, current }: { branches: StoreBranch[]; current: string | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const lang = uiLang();

  const open = (slug: string) => {
    const { base, dineIn, rest } = splitStorePath(location.pathname);
    // an unknown branch in the link is replaced, not kept
    const storeBase = current ? base.slice(0, base.lastIndexOf('/')) : base;
    const path = `${storeBase}/${encodeURIComponent(slug)}${dineIn ? '/dine-in' : ''}${rest}`;
    navigate({ pathname: path, search: location.search, hash: location.hash }, { replace: true });
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF5F7] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm">
        <h1 className="text-center text-xl font-semibold text-gray-900">
          {tr(lang, 'কোন শাখা থেকে অর্ডার করবেন?', 'Which branch are you ordering from?')}
        </h1>
        <ul className="mt-5 space-y-2">
          {branches.map((b) => (
            <li key={b.slug}>
              <button
                type="button"
                onClick={() => open(b.slug)}
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-left hover:border-[#FA2851] focus:border-[#FA2851] focus:outline-none"
              >
                <div className="font-medium text-gray-900">{b.name}</div>
                {b.address && <div className="mt-0.5 text-sm text-gray-500">{b.address}</div>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
