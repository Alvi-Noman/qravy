// apps/tastebud/src/pages/AIWaiter.tsx
import React from 'react';
import { useLocation, useParams, useSearchParams, Link } from 'react-router-dom';

export default function AIWaiter() {
  const { subdomain, branch, branchSlug } = useParams<{
    subdomain?: string;
    branch?: string;
    branchSlug?: string;
  }>();
  const [search] = useSearchParams();
  const location = useLocation();

  const resolvedSub =
    subdomain ??
    search.get('subdomain') ??
    (typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain : null) ??
    'demo';

  const resolvedBranch =
    branch ??
    branchSlug ??
    search.get('branch') ??
    (typeof window !== 'undefined' ? (window as any).__STORE__?.branch : null) ??
    undefined;

  // Build "See Menu" target
  const seeMenuHref = resolvedBranch
    ? `/t/${resolvedSub}/${resolvedBranch}/menu`
    : `/t/${resolvedSub}/menu`;

  return (
    <div className="min-h-screen bg-[#F6F5F8] font-[Inter] flex items-center">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-[30px] sm:text-[36px] font-semibold text-gray-900 mb-2">
          Meet your AI Waiter
        </h1>
        <p className="text-gray-600 mb-8">
          Ask for recommendations, dietary options, combos, or specials. Speak or type—your call.
        </p>

        {/* Placeholder for voice/chat UI hook-up */}
        <div className="rounded-2xl bg-white border p-6 shadow-sm mb-8">
          <p className="text-sm text-gray-500">(Voice/Chat UI goes here)</p>
        </div>

        <div className="flex gap-3">
          <Link
            to={seeMenuHref}
            className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium bg-black text-white hover:opacity-90"
          >
            See Menu
          </Link>
          {/* Optional: deep link to dine-in */}
          <Link
            to={
              resolvedBranch
                ? `/t/${resolvedSub}/${resolvedBranch}/dine-in`
                : `/t/${resolvedSub}/dine-in`
            }
            className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium bg-white text-gray-900 hover:bg-gray-50"
          >
            Dine-in View
          </Link>
        </div>

        {/* Dev aid: current path */}
        <p className="mt-6 text-xs text-gray-400">Path: {location.pathname}</p>
      </div>
    </div>
  );
}
