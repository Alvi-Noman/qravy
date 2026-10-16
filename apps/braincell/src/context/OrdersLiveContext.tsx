/**
 * Live orders for the whole admin app: one stream connection, the active orders, a "new orders" count
 * for the sidebar badge, and a chime when an order comes in. The same stream brings the guests'
 * "Call waiter" requests from their tables (calls), with a toast + chime when one comes in.
 * An order that arrived while the connection was down still chimes / prints / notifies once it's back. With the tab
 * in the background (or minimised), a desktop notification says which table / address.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from './AuthContext';
import { usePermissions } from './PermissionsContext';
import { useScope } from './ScopeContext';
import { useTenant } from '../hooks/useTenant';
import { loadPrintSettings, printOrder } from '../utils/thermalPrint';
import { toast } from '../components/Toaster';
import {
  listServiceRequests,
  updateServiceRequestStatus,
  SERVICE_KIND_LABEL,
  type ServiceRequest,
} from '../api/serviceRequests';
import {
  listOrders,
  streamOrders,
  updateOrderStatus,
  adjustOrderEta,
  OPEN_STATUSES,
  type AdminOrder,
  type OrderStatus,
} from '../api/orders';

type OrdersLive = {
  /** Open orders (placed → ready), in the selected branch */
  orders: AdminOrder[];
  /** Orders waiting to be accepted */
  newCount: number;
  loading: boolean;
  connected: boolean;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** sound is on, but the browser won't play it until someone clicks the page (just after it loaded) */
  soundBlocked: boolean;
  refresh: () => Promise<void>;
  setStatus: (id: string, status: OrderStatus) => Promise<AdminOrder>;
  /** +5 / −5 minutes on the ready time */
  adjustEta: (id: string, addMinutes: number) => Promise<AdminOrder>;
  /** Table calls in the selected branch: waiting first, then on the way, then done (last hour) */
  calls: ServiceRequest[];
  /** Calls nobody has answered yet */
  openCallCount: number;
  setCallStatus: (id: string, status: 'acknowledged' | 'resolved') => Promise<ServiceRequest>;
};

const Ctx = createContext<OrdersLive | undefined>(undefined);
const SOUND_KEY = 'orders:sound';

/** Two-tone chime (WebAudio — no asset to load). The browser plays it only after a click / key press on the page —
 *  unlockAudio does that on the first one (after every reload). */
let audioCtx: AudioContext | null = null;
function unlockAudio(): boolean {
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return true;
  } catch {
    return false;
  }
}
const audioRunning = () => audioCtx?.state === 'running';

/** A desktop notification — only when the tab isn't in front (it is → the toast, the badge and the chime do). */
function notify(title: string, body: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    const n = new Notification(title, { body, tag: `${title}:${body}`, requireInteraction: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications unavailable */
  }
}
function askNotifications() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    /* not supported */
  }
}

/** "Table 5" · "Delivery · Rahim · House 12, Road 3" · "Pickup · Rahim" (+ the branch when all branches are shown). */
function orderWhereText(o: AdminOrder, withBranch: boolean): string {
  const branch = withBranch && o.branch ? ` · ${o.branch}` : '';
  if (o.channel === 'online') {
    const kind = o.fulfillment === 'delivery' ? 'Delivery' : 'Pickup';
    const addr = o.fulfillment === 'delivery' && o.customer?.address ? ` · ${o.customer.address}` : '';
    return `${kind} · ${o.customer?.name ?? ''}${addr}${branch}`;
  }
  return `Table ${o.table ?? '?'}${o.tableVerified === false ? ' (typed, not scanned)' : ''}${branch}`;
}

function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
  } catch {
    /* audio unavailable */
  }
}

export function OrdersLiveProvider({ children }: { children: React.ReactNode }) {
  const { token, getToken, refreshToken } = useAuthContext();
  const signedIn = !!token;
  const { has } = usePermissions();
  const { activeLocationId } = useScope();
  const canRead = has('orders:read');

  const [all, setAll] = useState<AdminOrder[]>([]);
  const [allCalls, setAllCalls] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  // on unless this device turned it off — a new kitchen screen shouldn't miss orders because nobody found the button
  const [soundOn, setSoundState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [audioReady, setAudioReady] = useState(false);
  // the browser keeps sound locked after every page load until a click / key press: unlock it on the first one
  useEffect(() => {
    const unlock = () => {
      if (unlockAudio()) window.setTimeout(() => setAudioReady(audioRunning()), 50);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  // auto-print needs these inside the stream callback
  const { data: tenant } = useTenant();
  const printCtx = useRef({ locationId: activeLocationId, restaurant: '', timezone: '' });
  printCtx.current = {
    locationId: activeLocationId,
    restaurant: (tenant as { name?: string } | undefined)?.name ?? '',
    timezone: (tenant as { timezone?: string } | undefined)?.timezone ?? '',
  };

  const setSoundOn = useCallback((on: boolean) => {
    setSoundState(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    if (on) {
      chime(); // the click is the user gesture that unlocks audio — and a preview
      askNotifications(); // and the moment to ask for desktop notifications (a background tab still tells them)
      window.setTimeout(() => setAudioReady(audioRunning()), 50);
    }
  }, []);

  // orders this screen has already seen (and alerted for) — an order first seen in a re-sync after a dropped
  // connection still gets its chime / print / notification
  const knownIds = useRef<Set<string>>(new Set());
  const loadedOnce = useRef(false);

  /** A new order for this screen: chime, auto-print, tab title, desktop notification. */
  const alertNewOrder = useCallback((o: AdminOrder) => {
    const pc = printCtx.current;
    const mine = !pc.locationId || !o.locationId || o.locationId === pc.locationId;
    if (!mine) return; // another branch's order neither chimes nor prints here
    if (soundRef.current) chime();
    // "Auto-print new orders" (this device): kitchen ticket, and a receipt if asked
    const ps = loadPrintSettings();
    if (ps.autoPrint) {
      const opts = { paper: ps.paper, restaurant: pc.restaurant, timezone: pc.timezone || undefined };
      void printOrder(o, 'kitchen', opts);
      if (ps.autoPrintReceipt) void printOrder(o, 'receipt', opts);
    }
    // title nudge + desktop notification for a background tab
    if (document.visibilityState !== 'visible') document.title = `(New order) ${document.title.replace(/^\((New order|Table call)\) /, '')}`;
    notify(`New order #${o.orderNumber}`, orderWhereText(o, !pc.locationId));
  }, []);

  const upsert = useCallback((o: AdminOrder) => {
    knownIds.current.add(o.id);
    setAll((prev) => {
      const rest = prev.filter((x) => x.id !== o.id);
      return OPEN_STATUSES.includes(o.status) ? [...rest, o] : rest;
    });
  }, []);

  const upsertCall = useCallback((r: ServiceRequest) => {
    setAllCalls((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
  }, []);

  const refresh = useCallback(async () => {
    const t = getToken();
    if (!t || !canRead) return;
    setLoading(true);
    try {
      const [orders, calls] = await Promise.allSettled([listOrders(t, 'active'), listServiceRequests(t)]);
      if (orders.status === 'fulfilled') {
        // after the first load: a waiting order this screen never saw arrived while it was disconnected → alert now
        if (loadedOnce.current) {
          for (const o of orders.value) if (o.status === 'placed' && !knownIds.current.has(o.id)) alertNewOrder(o);
        }
        for (const o of orders.value) knownIds.current.add(o.id);
        loadedOnce.current = true;
        setAll(orders.value);
      }
      if (calls.status === 'fulfilled') setAllCalls(calls.value);
    } finally {
      setLoading(false);
    }
  }, [getToken, canRead, alertNewOrder]);

  // one connection while signed in — a refreshed token (every 15 min) doesn't reconnect it; a reconnect picks it up
  useEffect(() => {
    if (!signedIn || !canRead) {
      setAll([]);
      setAllCalls([]);
      knownIds.current = new Set();
      loadedOnce.current = false;
      return;
    }
    const stop = streamOrders(getToken, {
      onUnauthorized: refreshToken,
      onOpen: () => {
        setConnected(true);
        void refresh(); // re-sync anything missed while disconnected
      },
      onDown: () => setConnected(false),
      onService: (ev) => {
        const r = ev.request;
        upsertCall(r);
        // a new call, or the guest pressed again while it was still waiting (lastCalledAt moves only then)
        const called = ev.type === 'service.created' || (r.status === 'open' && r.lastCalledAt === r.updatedAt);
        const pc = printCtx.current;
        const mine = !pc.locationId || !r.locationId || r.locationId === pc.locationId;
        if (!called || !mine) return;
        if (soundRef.current) chime();
        const what = r.kind === 'other' && r.note ? r.note : SERVICE_KIND_LABEL[r.kind];
        // all branches on screen → say which branch's table (Table 1 is at every branch)
        const at = !pc.locationId && r.branch ? ` · ${r.branch}` : '';
        toast(`Table ${r.table}${at}: ${what}${r.calls > 1 ? ` (called ${r.calls}×)` : ''}`, { type: 'info', duration: 8000 });
        if (document.visibilityState !== 'visible') document.title = `(Table call) ${document.title.replace(/^\((New order|Table call)\) /, '')}`;
        notify(`Table ${r.table}${at}`, `${what}${r.calls > 1 ? ` (called ${r.calls}×)` : ''}`);
      },
      onEvent: (ev) => {
        const seen = knownIds.current.has(ev.order.id);
        upsert(ev.order);
        if (ev.type === 'order.created' && !seen) alertNewOrder(ev.order);
      },
    });
    return () => {
      stop();
      setConnected(false);
    };
  }, [signedIn, canRead, getToken, refreshToken, refresh, upsert, upsertCall, alertNewOrder]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') document.title = document.title.replace(/^\((New order|Table call)\) /, '');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const setStatus = useCallback(
    async (id: string, status: OrderStatus) => {
      if (!token) throw new Error('Not signed in');
      const o = await updateOrderStatus(token, id, status);
      upsert(o);
      return o;
    },
    [token, upsert],
  );

  const adjustEta = useCallback(
    async (id: string, addMinutes: number) => {
      if (!token) throw new Error('Not signed in');
      const o = await adjustOrderEta(token, id, addMinutes);
      upsert(o);
      return o;
    },
    [token, upsert],
  );

  const orders = useMemo(
    () =>
      all
        .filter((o) => !activeLocationId || !o.locationId || o.locationId === activeLocationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [all, activeLocationId],
  );
  const newCount = orders.filter((o) => o.status === 'placed').length;

  const setCallStatus = useCallback(
    async (id: string, status: 'acknowledged' | 'resolved') => {
      if (!token) throw new Error('Not signed in');
      const r = await updateServiceRequestStatus(token, id, status);
      upsertCall(r);
      return r;
    },
    [token, upsertCall],
  );

  const calls = useMemo(() => {
    const rank = { open: 0, acknowledged: 1, resolved: 2 } as const;
    return allCalls
      .filter((r) => !activeLocationId || !r.locationId || r.locationId === activeLocationId)
      .sort((a, b) => rank[a.status] - rank[b.status] || b.lastCalledAt.localeCompare(a.lastCalledAt));
  }, [allCalls, activeLocationId]);
  const openCallCount = calls.filter((r) => r.status === 'open').length;

  const value = useMemo<OrdersLive>(
    () => ({
      orders, newCount, loading, connected, soundOn, setSoundOn, soundBlocked: soundOn && !audioReady, refresh, setStatus, adjustEta, calls,
      openCallCount, setCallStatus,
    }),
    [orders, newCount, loading, connected, soundOn, setSoundOn, audioReady, refresh, setStatus, adjustEta, calls, openCallCount, setCallStatus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrdersLive(): OrdersLive {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOrdersLive must be used within OrdersLiveProvider');
  return v;
}

/** Safe variant for components that may render outside the provider (returns null). */
export function useOrdersLiveOptional(): OrdersLive | null {
  return useContext(Ctx) ?? null;
}
