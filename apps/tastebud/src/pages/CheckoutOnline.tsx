// apps/tastebud/src/pages/CheckoutOnline.tsx
// Online ordering isn't offered yet (dine-in only, pay at the counter) — send guests to the dine-in checkout.
import { Navigate, useParams } from 'react-router-dom';
import { checkoutPath } from '../utils/checkout-flow';

export default function CheckoutOnline() {
  const { subdomain, branchSlug, branch } = useParams<{ subdomain?: string; branchSlug?: string; branch?: string }>();
  return <Navigate replace to={checkoutPath(subdomain, branchSlug ?? branch)} />;
}
