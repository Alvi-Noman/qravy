// apps/tastebud/src/router.tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import UndoToast from './components/ai-waiter/UndoToast';
import { CartProvider } from './context/CartContext';
import KeepTableInUrl from './components/KeepTableInUrl';
import DineInGate from './components/DineInGate';

const Home = lazy(() => import('./pages/Directory'));
const Restaurant = lazy(() => import('./pages/DigitalMenu'));
const AIWaiter = lazy(() => import('./pages/AIWaiterHome'));
const ConfirmationPage = lazy(() => import('./pages/ConfirmationPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const OrderStatusPage = lazy(() => import('./pages/OrderStatusPage'));
const TenminOrbDemo = lazy(() => import('./pages/TenminOrbDemo'));
// dev only: listen to the Bangla voices / respellings side by side (never in a production build)
const VoiceTest = import.meta.env.DEV ? lazy(() => import('./pages/VoiceTest')) : null;

const hasTenantFromRuntime =
  typeof window !== 'undefined' &&
  (window as any)?.__STORE__ &&
  (window as any).__STORE__.subdomain;

export default function AppRouter() {
  return (
    <BrowserRouter>
      <CartProvider>
        {/* after every tray change (voice or tap): what changed + Undo */}
        <UndoToast />
        {/* online shop vs. dine-in ("/dine-in?table=12"): old links moved over, the table kept on every dine-in page */}
        <KeepTableInUrl />
        <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
          <Routes>
            {/* Demo routes */}
            <Route path="/demo/tenmin-orb" element={<TenminOrbDemo />} />
            {VoiceTest && <Route path="/voice-test" element={<VoiceTest />} />}

            {/* ================== Dev-style routes (path tenant) ==================
                The ONLINE SHOP (pickup / delivery — name, phone, address):
                  /t/<subdomain>                              -> AI waiter
                  /t/<subdomain>/menu                         -> menu
                  /t/<subdomain>/checkout, /order/<token>
                DINE-IN — the table's QR code, always with its table (none → it's asked first, DineInGate):
                  /t/<subdomain>/dine-in?table=12             -> AI waiter
                  /t/<subdomain>/dine-in/menu?table=12        -> menu
                  /t/<subdomain>/dine-in/checkout?table=12, /dine-in/order/<token>
                A branch goes before either: /t/<subdomain>/<branch>(/dine-in)…
                Old links ("?table=12" on an online page, "/menu/dine-in") are moved over by KeepTableInUrl.
            */}
            <Route path="/t/:subdomain" element={<AIWaiter />} />
            <Route path="/t/:subdomain/menu" element={<Restaurant />} />
            <Route path="/t/:subdomain/checkout" element={<CheckoutPage />} />
            <Route path="/t/:subdomain/confirmation" element={<ConfirmationPage />} />
            <Route path="/t/:subdomain/order/:token" element={<OrderStatusPage />} />
            <Route path="/t/:subdomain/dine-in" element={<DineInGate><AIWaiter /></DineInGate>} />
            <Route path="/t/:subdomain/dine-in/menu" element={<DineInGate><Restaurant /></DineInGate>} />
            <Route path="/t/:subdomain/dine-in/checkout" element={<DineInGate><CheckoutPage /></DineInGate>} />
            <Route path="/t/:subdomain/dine-in/confirmation" element={<DineInGate><ConfirmationPage /></DineInGate>} />
            <Route path="/t/:subdomain/dine-in/order/:token" element={<OrderStatusPage />} />
            <Route path="/t/:subdomain/menu/dine-in" element={<DineInGate><Restaurant /></DineInGate>} />
            <Route path="/t/:subdomain/online" element={<Navigate replace to=".." relative="path" />} />

            <Route path="/t/:subdomain/:branchSlug" element={<AIWaiter />} />
            <Route path="/t/:subdomain/:branchSlug/menu" element={<Restaurant />} />
            <Route path="/t/:subdomain/:branchSlug/checkout" element={<CheckoutPage />} />
            <Route path="/t/:subdomain/:branchSlug/confirmation" element={<ConfirmationPage />} />
            <Route path="/t/:subdomain/:branchSlug/order/:token" element={<OrderStatusPage />} />
            <Route path="/t/:subdomain/:branchSlug/dine-in" element={<DineInGate><AIWaiter /></DineInGate>} />
            <Route path="/t/:subdomain/:branchSlug/dine-in/menu" element={<DineInGate><Restaurant /></DineInGate>} />
            <Route path="/t/:subdomain/:branchSlug/dine-in/checkout" element={<DineInGate><CheckoutPage /></DineInGate>} />
            <Route path="/t/:subdomain/:branchSlug/dine-in/confirmation" element={<DineInGate><ConfirmationPage /></DineInGate>} />
            <Route path="/t/:subdomain/:branchSlug/dine-in/order/:token" element={<OrderStatusPage />} />
            <Route path="/t/:subdomain/:branchSlug/menu/dine-in" element={<DineInGate><Restaurant /></DineInGate>} />

            {/* ================== Prod-style routes (subdomain at host) ==================
                burger-house.qravy.com                        -> online shop (AI waiter); /menu, /checkout, /order/<token>
                burger-house.qravy.com/dine-in?table=12       -> dine-in (AI waiter); /dine-in/menu, /dine-in/checkout …
                burger-house.qravy.com/<branch>(/dine-in)…    -> the same for a branch
               These rely on window.__STORE__.subdomain injected by the host.
            */}
            <Route path="/" element={hasTenantFromRuntime ? <AIWaiter /> : <Home />} />
            <Route path="/menu" element={<Restaurant />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/confirmation" element={<ConfirmationPage />} />
            <Route path="/order/:token" element={<OrderStatusPage />} />
            <Route path="/dine-in" element={<DineInGate><AIWaiter /></DineInGate>} />
            <Route path="/dine-in/menu" element={<DineInGate><Restaurant /></DineInGate>} />
            <Route path="/dine-in/checkout" element={<DineInGate><CheckoutPage /></DineInGate>} />
            <Route path="/dine-in/confirmation" element={<DineInGate><ConfirmationPage /></DineInGate>} />
            <Route path="/dine-in/order/:token" element={<OrderStatusPage />} />
            <Route path="/menu/dine-in" element={<DineInGate><Restaurant /></DineInGate>} />

            <Route path="/:branch" element={<AIWaiter />} />
            <Route path="/:branch/menu" element={<Restaurant />} />
            <Route path="/:branch/checkout" element={<CheckoutPage />} />
            <Route path="/:branch/confirmation" element={<ConfirmationPage />} />
            <Route path="/:branch/order/:token" element={<OrderStatusPage />} />
            <Route path="/:branch/dine-in" element={<DineInGate><AIWaiter /></DineInGate>} />
            <Route path="/:branch/dine-in/menu" element={<DineInGate><Restaurant /></DineInGate>} />
            <Route path="/:branch/dine-in/checkout" element={<DineInGate><CheckoutPage /></DineInGate>} />
            <Route path="/:branch/dine-in/confirmation" element={<DineInGate><ConfirmationPage /></DineInGate>} />
            <Route path="/:branch/dine-in/order/:token" element={<OrderStatusPage />} />
            <Route path="/:branch/menu/dine-in" element={<DineInGate><Restaurant /></DineInGate>} />

            {/* Fallback 404 → Home (or AIWaiter if tenant runtime present) */}
            <Route
              path="*"
              element={<Navigate replace to={hasTenantFromRuntime ? '/' : '/'} />}
            />
          </Routes>
        </Suspense>
      </CartProvider>
    </BrowserRouter>
  );
}
