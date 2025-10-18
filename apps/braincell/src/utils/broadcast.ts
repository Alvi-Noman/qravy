// Cross-tab and same-tab broadcast helpers for menu/categories updates.
// - Uses BroadcastChannel when available
// - Falls back to window events + localStorage for older browsers

type Unsubscribe = () => void;

function safeLocalSet(key: string, value: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {}
}

function hasBC(): boolean {
  try {
    return typeof window !== 'undefined' && 'BroadcastChannel' in window;
  } catch {
    return false;
  }
}

function post(name: 'menu' | 'categories') {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`${name}:updated`));
    }
    safeLocalSet(`${name}:updated`, String(Date.now()));
    if (hasBC()) {
      const bc = new BroadcastChannel(name);
      bc.postMessage({ type: 'updated', at: Date.now() });
      try {
        bc.close();
      } catch {}
    }
  } catch {}
}

function on(name: 'menu' | 'categories', cb: () => void): Unsubscribe {
  const onCustom = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.key === `${name}:updated`) cb();
  };

  let bc: BroadcastChannel | undefined;
  if (hasBC()) {
    bc = new BroadcastChannel(name);
    bc.onmessage = () => cb();
  }

  try {
    if (typeof window !== 'undefined') {
      window.addEventListener(`${name}:updated` as any, onCustom as EventListener);
      window.addEventListener('storage', onStorage);
    }
  } catch {}

  return () => {
    try {
      if (typeof window !== 'undefined') {
        window.removeEventListener(`${name}:updated` as any, onCustom as EventListener);
        window.removeEventListener('storage', onStorage);
      }
      bc?.close();
    } catch {}
  };
}

// Public API
export function postMenuUpdated(): void {
  post('menu');
}
export function postCategoriesUpdated(): void {
  post('categories');
}
export function onMenuUpdated(cb: () => void): Unsubscribe {
  return on('menu', cb);
}
export function onCategoriesUpdated(cb: () => void): Unsubscribe {
  return on('categories', cb);
}