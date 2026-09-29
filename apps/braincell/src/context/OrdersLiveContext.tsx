/**
 * Live orders for the whole admin app: one stream connection, the active orders, a "new orders" count
 * for the sidebar badge, and an optional chime when an order comes in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from './AuthContext';
import { usePermissions } from './PermissionsContext';
import { useScope } from './ScopeContext';
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
  refresh: () => Promise<void>;
  setStatus: (id: string, status: OrderStatus) => Promise<AdminOrder>;
  /** +5 / −5 minutes on the ready time */
  adjustEta: (id: string, addMinutes: number) => Promise<AdminOrder>;
};

const Ctx = createContext<OrdersLive | undefined>(undefined);
const SOUND_KEY = 'orders:sound';

/** Two-tone chime (WebAudio — no asset to load). Needs one user gesture first (the sound toggle). */
let audioCtx: AudioContext | null = null;
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
  const { token } = useAuthContext();
  const { has } = usePermissions();
  const { activeLocationId } = useScope();
  const canRead = has('orders:read');

  const [all, setAll] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [soundOn, setSoundState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SOUND_KEY) === '1';
    } catch {
      return false;
    }
  });
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  const setSoundOn = useCallback((on: boolean) => {
    setSoundState(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    if (on) chime(); // the click is the user gesture that unlocks audio — and a preview
  }, []);

  const upsert = useCallback((o: AdminOrder) => {
    setAll((prev) => {
      const rest = prev.filter((x) => x.id !== o.id);
      return OPEN_STATUSES.includes(o.status) ? [...rest, o] : rest;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!token || !canRead) return;
    setLoading(true);
    try {
      setAll(await listOrders(token, 'active'));
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
    }
  }, [token, canRead]);

  useEffect(() => {
    if (!token || !canRead) {
      setAll([]);
      return;
    }
    const stop = streamOrders(token, {
      onOpen: () => {
        setConnected(true);
        void refresh(); // re-sync anything missed while disconnected
      },
      onDown: () => setConnected(false),
      onEvent: (ev) => {
        upsert(ev.order);
        if (ev.type === 'order.created') {
          if (soundRef.current) chime();
          // title nudge for a background tab
          if (document.visibilityState !== 'visible') document.title = `(New order) ${document.title.replace(/^\(New order\) /, '')}`;
        }
      },
    });
    return () => {
      stop();
      setConnected(false);
    };
  }, [token, canRead, refresh, upsert]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') document.title = document.title.replace(/^\(New order\) /, '');
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

  const value = useMemo<OrdersLive>(
    () => ({ orders, newCount, loading, connected, soundOn, setSoundOn, refresh, setStatus, adjustEta }),
    [orders, newCount, loading, connected, soundOn, setSoundOn, refresh, setStatus, adjustEta],
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
