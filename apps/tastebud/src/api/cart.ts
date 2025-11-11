const API_BASE = import.meta.env.VITE_AI_WAITER_API || "http://localhost:7081";

export async function loadCart(tenant: string, sessionId: string) {
  const res = await fetch(`${API_BASE}/cart/load?tenant=${tenant}&sessionId=${sessionId}`);
  return await res.json();
}

export async function saveCart(tenant: string, sessionId: string, items: any[]) {
  await fetch(`${API_BASE}/cart/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant, sessionId, items }),
  });
}
