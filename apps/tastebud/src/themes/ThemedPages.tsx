// apps/tastebud/src/themes/ThemedPages.tsx
// The router's pages, by theme: the same route shows the restaurant's theme (theme.ts). Each theme's pages load on
// their own, so a guest only downloads the look their restaurant uses.
import { lazy, Suspense, type ReactNode } from 'react';
import { useStoreTheme } from './theme';

// Petal — the original pages, unchanged
const PetalHome = lazy(() => import('../pages/AIWaiterHome'));
const PetalMenu = lazy(() => import('../pages/DigitalMenu'));
const PetalCheckout = lazy(() => import('../pages/CheckoutPage'));
const PetalOrder = lazy(() => import('../pages/OrderStatusPage'));

// Ember — the default theme
const EmberHome = lazy(() => import('./ember/EmberHome'));
const EmberMenu = lazy(() => import('./ember/EmberMenu'));
const EmberCheckout = lazy(() => import('./ember/EmberCheckout'));
const EmberOrder = lazy(() => import('./ember/EmberOrder'));

function Themed({ petal, ember }: { petal: ReactNode; ember: ReactNode }) {
  const theme = useStoreTheme();
  // while the restaurant's info loads: a blank page (never a flash of the other theme)
  if (!theme) return <div className="min-h-screen" />;
  return <Suspense fallback={<div className="min-h-screen" style={{ background: theme === 'ember' ? '#0B0B0C' : undefined }} />}>{theme === 'ember' ? ember : petal}</Suspense>;
}

/** The waiter's home (online shop or the table's page). */
export function ThemedHome() {
  return <Themed petal={<PetalHome />} ember={<EmberHome />} />;
}

export function ThemedMenu() {
  return <Themed petal={<PetalMenu />} ember={<EmberMenu />} />;
}

export function ThemedCheckout() {
  return <Themed petal={<PetalCheckout />} ember={<EmberCheckout />} />;
}

export function ThemedOrder() {
  return <Themed petal={<PetalOrder />} ember={<EmberOrder />} />;
}
