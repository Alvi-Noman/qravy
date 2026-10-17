// apps/braincell/src/features/billing/subscribeError.ts — why subscribing didn't go through, said plainly (it used to
// fail silently, with only "Subscribe failed" in the console). Billing is the owner's: not from a Qravy support session,
// not from a branch device / branch login.
export function subscribeErrorText(e: unknown): string {
  const res = (e as { response?: { status?: number; data?: { message?: string; code?: string } } })?.response;
  const msg = res?.data?.message || '';
  if (res?.data?.code === 'SUPPORT_DENIED' || /Qravy support/i.test(msg)) {
    return 'Only the restaurant owner can subscribe or change billing — not from a Qravy support session. Ask the owner to subscribe from their own login.';
  }
  if (/branch device|branch login/i.test(msg)) {
    return 'This browser is signed in as one of the restaurant’s branch devices, and billing can’t be changed from a branch. Switch to “All branches” in the sidebar (owners and admins), or subscribe from the owner’s own device.';
  }
  if (res?.status === 403) return msg || 'You don’t have permission to change billing for this restaurant.';
  return msg || 'Subscribing didn’t go through. Please try again.';
}
