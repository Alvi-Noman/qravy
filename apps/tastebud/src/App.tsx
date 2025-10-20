import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense } from 'react';
import { CartProvider } from './context/CartContext';

// Pages
import Home from './pages/Home';
import CheckoutDineIn from './pages/CheckoutDineIn';
import CheckoutOnline from './pages/CheckoutOnline';
import OrderPlaced from './pages/OrderPlaced';

// Optional: a tiny fallback to keep UX consistent with braincell
function Fallback() {
  return <div className="p-6 text-sm text-slate-600">Loading…</div>;
}

/**
 * Storefront App shell:
 * - Uses CartProvider (channel-aware)
 * - Router structure mirrors your other app
 */
export default function App() {
  return (
    <CartProvider>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<Fallback />}>
              <Home />
            </Suspense>
          }
        />

        {/* Dine-In checkout (auto table via ?table=12) */}
        <Route
          path="/checkout/dine-in"
          element={
            <Suspense fallback={<Fallback />}>
              <CheckoutDineIn />
            </Suspense>
          }
        />

        {/* Online checkout */}
        <Route
          path="/checkout/online"
          element={
            <Suspense fallback={<Fallback />}>
              <CheckoutOnline />
            </Suspense>
          }
        />

        {/* Confirmation */}
        <Route
          path="/order/placed"
          element={
            <Suspense fallback={<Fallback />}>
              <OrderPlaced />
            </Suspense>
          }
        />

        {/* Legacy/typo guard examples */}
        <Route path="/checkout" element={<Navigate to="/" replace />} />
      </Routes>
    </CartProvider>
  );
}
