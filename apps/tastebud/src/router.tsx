// apps/tastebud/src/router.tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import UndoToast from './components/ai-waiter/UndoToast';
import { CartProvider } from './context/CartContext';
import KeepTableInUrl from './components/KeepTableInUrl';
import DineInGate from './components/DineInGate';
import BranchGate from './components/BranchGate';
import TrackPageViews from './components/TrackPageViews';

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
        {/* page views, QR scans, time on page — for the company's Cortex panel (utils/track.ts) */}
        <TrackPageViews />
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
            <Route path="/t/:subdomain" element={<BranchGate><AIWaiter /></BranchGate>} />
            <Route path="/t/:subdomain/menu" element={<BranchGate><Restaurant /></BranchGate>} />
            <Route path="/t/:subdomain/checkout" element={<CheckoutPage />} />
            <Route path="/t/:subdomain/confirmation" element={<ConfirmationPage />} />
            <Route path="/t/:subdomain/order/:token" element={<OrderStatusPage />} />
            <Route path="/t/:subdomain/dine-in" element={<BranchGate><DineInGate><AIWaiter /></DineInGate></BranchGate>} />
            <Route path="/t/:subdomain/dine-in/menu" element={<BranchGate><DineInGate><Restaurant /></DineInGate></BranchGate>} />
            <Route path="/t/:subdomain/dine-in/checkout" element={<DineInGate><CheckoutPage /></DineInGate>} />
            <Route path="/t/:subdomain/dine-in/confirmation" element={<DineInGate><ConfirmationPage /></DineInGate>} />
            <Route path="/t/:subdomain/dine-in/order/:token" element={<OrderStatusPage />} />
            <Route path="/t/:subdomain/menu/dine-in" element={<BranchGate><DineInGate><Restaurant /></DineInGate></BranchGate>} />
            <Route path="/t/:subdomain/online" element={<Navigate replace to=".." relative="path" />} />

            <Route path="/t/:subdomain/:branchSlug" element={<BranchGate><AIWaiter /></BranchGate>} />
            <Route path="/t/:subdomain/:branchSlug/menu" element={<BranchGate><Restaurant /></BranchGate>} />
            <Route path="/t/:subdomain/:branchSlug/checkout" element={<CheckoutPage />} />
            <Route path="/t/:subdomain/:branchSlug/confirmation" element={<ConfirmationPage />} />
            <Route path="/t/:subdomain/:branchSlug/order/:token" element={<OrderStatusPage />} />
            <Route path="/t/:subdomain/:branchSlug/dine-in" element={<BranchGate><DineInGate><AIWaiter /></DineInGate></BranchGate>} />
            <Route path="/t/:subdomain/:branchSlug/dine-in/menu" element={<BranchGate><DineInGate><Restaurant /></DineInGate></BranchGate>} />
            <Route path="/t/:subdomain/:branchSlug/dine-in/checkout" element={<DineInGate><CheckoutPage /></DineInGate>} />
            <Route path="/t/:subdomain/:branchSlug/dine-in/confirmation" element={<DineInGate><ConfirmationPage /></DineInGate>} />
            <Route path="/t/:subdomain/:branchSlug/dine-in/order/:token" element={<OrderStatusPage />} />
            <Route path="/t/:subdomain/:branchSlug/menu/dine-in" element={<BranchGate><DineInGate><Restaurant /></DineInGate></BranchGate>} />

            {/* ================== Prod-style routes (subdomain at host) ==================
                burger-house.qravy.com                        -> online shop (AI waiter); /menu, /checkout, /order/<token>
                burger-house.qravy.com/dine-in?table=12       -> dine-in (AI waiter); /dine-in/menu, /dine-in/checkout …
                burger-house.qravy.com/<branch>(/dine-in)…    -> the same for a branch
               These rely on window.__STORE__.subdomain injected by the host.
            */}
            <Route path="/" element={hasTenantFromRuntime ? <BranchGate><AIWaiter /></BranchGate> : <Home />} />
            <Route path="/menu" element={<BranchGate><Restaurant /></BranchGate>} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/confirmation" element={<ConfirmationPage />} />
            <Route path="/order/:token" element={<OrderStatusPage />} />
            <Route path="/dine-in" element={<BranchGate><DineInGate><AIWaiter /></DineInGate></BranchGate>} />
            <Route path="/dine-in/menu" element={<BranchGate><DineInGate><Restaurant /></DineInGate></BranchGate>} />
            <Route path="/dine-in/checkout" element={<DineInGate><CheckoutPage /></DineInGate>} />
            <Route path="/dine-in/confirmation" element={<DineInGate><ConfirmationPage /></DineInGate>} />
            <Route path="/dine-in/order/:token" element={<OrderStatusPage />} />
            <Route path="/menu/dine-in" element={<BranchGate><DineInGate><Restaurant /></DineInGate></BranchGate>} />

            <Route path="/:branch" element={<BranchGate><AIWaiter /></BranchGate>} />
            <Route path="/:branch/menu" element={<BranchGate><Restaurant /></BranchGate>} />
            <Route path="/:branch/checkout" element={<CheckoutPage />} />
            <Route path="/:branch/confirmation" element={<ConfirmationPage />} />
            <Route path="/:branch/order/:token" element={<OrderStatusPage />} />
            <Route path="/:branch/dine-in" element={<BranchGate><DineInGate><AIWaiter /></DineInGate></BranchGate>} />
            <Route path="/:branch/dine-in/menu" element={<BranchGate><DineInGate><Restaurant /></DineInGate></BranchGate>} />
            <Route path="/:branch/dine-in/checkout" element={<DineInGate><CheckoutPage /></DineInGate>} />
            <Route path="/:branch/dine-in/confirmation" element={<DineInGate><ConfirmationPage /></DineInGate>} />
            <Route path="/:branch/dine-in/order/:token" element={<OrderStatusPage />} />
            <Route path="/:branch/menu/dine-in" element={<BranchGate><DineInGate><Restaurant /></DineInGate></BranchGate>} />

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
