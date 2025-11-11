// apps/tastebud/src/pages/ConfirmationPage.tsx
import React from 'react';
import { useParams } from 'react-router-dom';
import MicInputBar from '../components/ai-waiter/MicInputBar';

export default function ConfirmationPage() {
  const { subdomain, branchSlug, branch } = useParams<{
    subdomain?: string;
    branchSlug?: string;
    branch?: string;
  }>();

  const tenantSlug =
    subdomain ??
    ((typeof window !== 'undefined'
      ? (window as any).__STORE__?.subdomain
      : undefined) || undefined);

  const branchHint =
    branchSlug ??
    branch ??
    ((typeof window !== 'undefined'
      ? (window as any).__STORE__?.branch
      : undefined) || undefined);

  return (
    <div className="min-h-screen bg-[#F6F5F8] flex flex-col">
      <div className="max-w-3xl mx-auto w-full px-4 pt-10 pb-6 flex-1 flex flex-col items-center text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-3">
          Order preview & confirmation
        </h1>
        <p className="text-sm text-gray-600 max-w-md mb-8">
          Your AI waiter will read back your items. You can confirm, tweak quantities,
          or ask to change anything using your voice.
        </p>
      </div>

      {/* Sticky mic bar at the bottom, reusing the shared MicInputBar */}
      <div className="sticky bottom-0 inset-x-0 z-40 bg-[#F6F5F8] pb-4">
        <div className="mx-auto max-w-3xl px-4">
          <MicInputBar
            tenant={tenantSlug}
            branch={branchHint}
            channel="dine-in"
          />
        </div>
      </div>
    </div>
  );
}
