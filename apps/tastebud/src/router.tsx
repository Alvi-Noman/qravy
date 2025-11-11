// apps/tastebud/src/router.tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CartProvider } from './context/CartContext';

const Home = lazy(() => import('./pages/Directory'));
const Restaurant = lazy(() => import('./pages/DigitalMenu'));
const AIWaiter = lazy(() => import('./pages/AIWaiterHome'));
const ConfirmationPage = lazy(() => import('./pages/ConfirmationPage'));

const hasTenantFromRuntime =
  typeof window !== 'undefined' &&
  (window as any)?.__STORE__ &&
  (window as any).__STORE__.subdomain;

export default function AppRouter() {
  return (
    <BrowserRouter>
      <CartProvider>
        <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
          <Routes>
            {/* ================== Dev-style routes (path tenant) ==================
                http://localhost:5174/t/<subdomain>                          -> AIWaiter (entry)
                http://localhost:5174/t/<subdomain>/menu                     -> Online Menu
                http://localhost:5174/t/<subdomain>/menu/dine-in             -> Dine-in Menu
                http://localhost:5174/t/<subdomain>/<branchSlug>             -> AIWaiter (branch entry)
                http://localhost:5174/t/<subdomain>/<branchSlug>/menu        -> Online Menu (branch)
                http://localhost:5174/t/<subdomain>/<branchSlug>/menu/dine-in-> Dine-in Menu (branch)
            */}
            <Route path="/t/:subdomain" element={<AIWaiter />} />
            <Route path="/t/:subdomain/menu" element={<Restaurant />} />
            <Route path="/t/:subdomain/menu/dine-in" element={<Restaurant />} />

            <Route path="/t/:subdomain/:branchSlug" element={<AIWaiter />} />
            <Route path="/t/:subdomain/:branchSlug/menu" element={<Restaurant />} />
            <Route path="/t/:subdomain/:branchSlug/menu/dine-in" element={<Restaurant />} />

            {/* Confirmation (dev-style) */}
            <Route path="/t/:subdomain/confirmation" element={<ConfirmationPage />} />
            <Route
              path="/t/:subdomain/:branchSlug/confirmation"
              element={<ConfirmationPage />}
            />

            {/* Optional helpers / legacy redirects */}
            <Route path="/t/:subdomain/online" element={<Navigate replace to="menu" />} />
            <Route path="/t/:subdomain/dine-in" element={<Navigate replace to="menu/dine-in" />} />
            <Route
              path="/t/:subdomain/:branchSlug/dine-in"
              element={<Navigate replace to="menu/dine-in" />}
            />

            {/* ================== Prod-style routes (subdomain at host) ==================
                chillox.qravy.com                        -> AIWaiter (entry)
                chillox.qravy.com/menu                   -> Online Menu
                chillox.qravy.com/menu/dine-in           -> Dine-in Menu
                chillox.qravy.com/<branch>               -> AIWaiter (branch entry)
                chillox.qravy.com/<branch>/menu          -> Online Menu (branch)
                chillox.qravy.com/<branch>/menu/dine-in  -> Dine-in Menu (branch)
               These rely on window.__STORE__.subdomain injected by the host.
            */}
            <Route path="/" element={hasTenantFromRuntime ? <AIWaiter /> : <Home />} />
            <Route path="/menu" element={<Restaurant />} />
            <Route path="/menu/dine-in" element={<Restaurant />} />

            <Route path="/:branch" element={<AIWaiter />} />
            <Route path="/:branch/menu" element={<Restaurant />} />
            <Route path="/:branch/menu/dine-in" element={<Restaurant />} />

            {/* Confirmation (prod-style) */}
            <Route path="/confirmation" element={<ConfirmationPage />} />
            <Route path="/:branch/confirmation" element={<ConfirmationPage />} />

            {/* Optional helpers / legacy redirects */}
            <Route path="/dine-in" element={<Navigate replace to="/menu/dine-in" />} />

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
