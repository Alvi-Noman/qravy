const API_BASE =
  import.meta.env.VITE_AI_WAITER_API ||
  (import.meta.env.DEV ? "http://localhost:7081" : "/cart-api");

/** The waiter's copy of the tray — one per restaurant, branch and guest. */
export async function loadCart(tenant: string, sessionId: string, branch?: string | null) {
  const b = branch ? `&branch=${encodeURIComponent(branch)}` : '';
  const res = await fetch(`${API_BASE}/cart/load?tenant=${tenant}&sessionId=${sessionId}${b}`);
  return await res.json();
}

export async function saveCart(tenant: string, sessionId: string, items: any[], branch?: string | null) {
  await fetch(`${API_BASE}/cart/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant, sessionId, items, ...(branch ? { branch } : {}) }),
  });
}
