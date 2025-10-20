// apps/tastebud/src/router.tsx
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Home from "./pages/Home";
import CheckoutDineIn from "./pages/CheckoutDineIn";
import CheckoutOnline from "./pages/CheckoutOnline";
import OrderPlaced from "./pages/OrderPlaced";

function RouteError() {
  return (
    <div style={{ padding: 24 }}>
      <h2>Something went wrong</h2>
      <p>Please try refreshing the page.</p>
    </div>
  );
}

// Explicitly assert to the factory's return type to avoid TS2742
const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      { path: "checkout/dine-in", element: <CheckoutDineIn /> },
      { path: "checkout/online", element: <CheckoutOnline /> },
      { path: "order/placed", element: <OrderPlaced /> },
    ],
  },
]) as ReturnType<typeof createBrowserRouter>;

export default router;

// Optional convenience component
export function RootRouter() {
  return <RouterProvider router={router} />;
}
