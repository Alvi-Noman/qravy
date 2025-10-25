import { Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import Home from "./pages/Home";
import Restaurant from "./pages/Restaurant";

function RedirectToTenant() {
  const { subdomain } = useParams();
  return <Navigate to={`/t/${subdomain}`} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
      <Routes>
        {/* Generic homepage */}
        <Route path="/" element={<Home />} />

        {/* Tenant storefront routes */}
        <Route path="/t/:subdomain" element={<Restaurant />} />
        <Route path="/t/:subdomain/dine-in" element={<Restaurant />} />

        {/* NEW: branch without /branch prefix */}
        <Route path="/t/:subdomain/:branch" element={<Restaurant />} />
        <Route path="/t/:subdomain/:branch/dine-in" element={<Restaurant />} />

        {/* Legacy routes still supported (kept for compatibility) */}
        <Route path="/t/:subdomain/branch/:branchSlug" element={<Restaurant />} />
        <Route path="/t/:subdomain/branch/:branchSlug/dine-in" element={<Restaurant />} />

        {/* Optional short alias -> redirect to /t/:subdomain */}
        <Route path="/:subdomain" element={<RedirectToTenant />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
