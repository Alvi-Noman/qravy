// src/pages/Home.tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listMenu } from "../api/storefront";
import type { v1 } from "../../../../packages/shared/src/types";
import ProductCard from "../components/ProductCard";
import ProductModal from "../components/ProductModal";
import ChannelSwitch from "../components/ChannelSwitch";
import CartDrawer from "../components/CartDrawer";
import { useCart } from "../context/CartContext";

/**
 * Helper to get a stable key even if `id` isn't present yet.
 */
function itemKey(i: Partial<v1.MenuItemDTO>, idx: number) {
  // Prefer explicit `id`; fall back to _id/sku/slug; finally index as last resort
  return (i as any).id ?? (i as any)._id ?? (i as any).sku ?? (i as any).slug ?? idx;
}

export default function Home() {
  const { channel } = useCart(); // 'dine-in' | 'online'
  const [open, setOpen] = useState<v1.MenuItemDTO | null>(null);

  /**
   * Fetch menu items keyed by channel.
   * - `initialData: []` prevents undefined on first render
   * - `select` coerces to an array just in case
   */
  const {
    data: items = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<v1.MenuItemDTO[], Error>({
    queryKey: ["menu", channel],
    queryFn: () => listMenu(channel),
    initialData: [],
    staleTime: 30_000,
    retry: 1,
    select: (data) => (Array.isArray(data) ? data : []),
  });

  // Always operate on an array
  const safeItems = useMemo<v1.MenuItemDTO[]>(
    () => (Array.isArray(items) ? items : []),
    [items]
  );

  /**
   * Filter visibility by current channel.
   * If no visibility is set, treat item as visible.
   */
  const visible = useMemo(() => {
    const dine = channel === "dine-in";
    return safeItems.filter((i) => {
      const v = i.visibility;
      if (!v) return true; // default visible
      return dine ? v.dineIn !== false : v.online !== false;
    });
  }, [safeItems, channel]);

  // --- Render states ---------------------------------------------------------

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Menu</h1>
          <ChannelSwitch />
        </header>
        {/* simple skeletons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border p-4 space-y-3"
            >
              <div className="h-4 w-2/3 bg-gray-200 rounded" />
              <div className="h-3 w-1/2 bg-gray-200 rounded" />
              <div className="h-24 w-full bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        <CartDrawer />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-6xl mx-auto p-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Menu</h1>
          <ChannelSwitch />
        </header>
        <div className="mt-6 rounded-xl border p-4 bg-red-50 text-red-700">
          <div className="font-medium mb-2">Failed to load menu</div>
          <div className="text-sm opacity-80">
            {(error && (error.message || String(error))) || "Unknown error"}
          </div>
          <button
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center rounded-lg px-3 py-1.5 border text-sm"
          >
            Try again
          </button>
        </div>
        <CartDrawer />
      </div>
    );
  }

  // --- Normal render ---------------------------------------------------------

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Menu</h1>
        <ChannelSwitch />
      </header>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl border p-4 text-gray-600">
          No items available for this channel.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          {visible.map((it, idx) => (
            <ProductCard
              key={itemKey(it, idx)}
              item={it}
              onClick={() => setOpen(it)}
            />
          ))}
        </div>
      )}

      {open && <ProductModal item={open} onClose={() => setOpen(null)} />}
      <CartDrawer />
    </div>
  );
}
