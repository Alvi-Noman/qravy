// apps/tastebud/src/router.tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CartProvider } from './context/CartContext';

const Home = lazy(() => import('./pages/Home'));
const Restaurant = lazy(() => import('./pages/Restaurant'));

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
                http://localhost:5174/t/<subdomain>                   -> online
                http://localhost:5174/t/<subdomain>/dine-in           -> dine-in
                http://localhost:5174/t/<subdomain>/<branchSlug>      -> branch online   (no /branch)
                http://localhost:5174/t/<subdomain>/<branchSlug>/dine-in -> branch dine-in (no /branch)
            */}
            <Route path="/t/:subdomain" element={<Restaurant />} />
            <Route path="/t/:subdomain/dine-in" element={<Restaurant />} />
            <Route path="/t/:subdomain/:branchSlug" element={<Restaurant />} />
            <Route path="/t/:subdomain/:branchSlug/dine-in" element={<Restaurant />} />
            {/* Optional helper: /t/:subdomain/online -> /t/:subdomain */}
            <Route path="/t/:subdomain/online" element={<Navigate replace to=".." />} />

            {/* ================== Prod-style routes (subdomain at host) ==================
                chillox.qravy.com                   -> online
                chillox.qravy.com/dine-in           -> dine-in
                chillox.qravy.com/<branch>          -> branch online
                chillox.qravy.com/<branch>/dine-in  -> branch dine-in
               These rely on window.__STORE__.subdomain injected by the host.
            */}
            <Route path="/" element={hasTenantFromRuntime ? <Restaurant /> : <Home />} />
            <Route path="/dine-in" element={<Restaurant />} />
            <Route path="/:branch" element={<Restaurant />} />
            <Route path="/:branch/dine-in" element={<Restaurant />} />

            {/* Fallback 404 → Home (or Restaurant if tenant runtime present) */}
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
