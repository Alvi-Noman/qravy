// apps/tastebud/src/app.tsx
import { Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import Home from "./pages/Directory";
import Restaurant from "./pages/DigitalMenu";
import AIWaiter from "./pages/AIWaiterHome";

function RedirectToTenant() {
  const { subdomain } = useParams();
  return <Navigate to={`/t/${subdomain}`} replace />;
}

export default function App() {
  const hasTenantFromRuntime =
    typeof window !== 'undefined' &&
    (window as any)?.__STORE__ &&
    (window as any).__STORE__.subdomain;

  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
      <Routes>
        {/* Generic homepage */}
        <Route path="/" element={hasTenantFromRuntime ? <AIWaiter /> : <Home />} />

        {/* Tenant storefront routes - AIWaiter as entry */}
        <Route path="/t/:subdomain" element={<AIWaiter />} />
        <Route path="/t/:subdomain/menu" element={<Restaurant />} />
        <Route path="/t/:subdomain/menu/dine-in" element={<Restaurant />} />

        {/* Branch without /branch prefix */}
        <Route path="/t/:subdomain/:branch" element={<AIWaiter />} />
        <Route path="/t/:subdomain/:branch/menu" element={<Restaurant />} />
        <Route path="/t/:subdomain/:branch/menu/dine-in" element={<Restaurant />} />

        {/* Legacy routes still supported (kept for compatibility) */}
        <Route path="/t/:subdomain/branch/:branchSlug" element={<AIWaiter />} />
        <Route path="/t/:subdomain/branch/:branchSlug/menu" element={<Restaurant />} />
        <Route path="/t/:subdomain/branch/:branchSlug/menu/dine-in" element={<Restaurant />} />

        {/* Optional helpers / legacy redirects */}
        <Route path="/t/:subdomain/online" element={<Navigate replace to="menu" />} />
        <Route path="/t/:subdomain/dine-in" element={<Navigate replace to="menu/dine-in" />} />
        <Route
          path="/t/:subdomain/:branch/dine-in"
          element={<Navigate replace to="menu/dine-in" />}
        />

        {/* Optional short alias -> redirect to /t/:subdomain */}
        <Route path="/:subdomain" element={<RedirectToTenant />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
