import { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { useAuthContext } from './AuthContext';

export type ChannelScope = 'all' | 'dine-in' | 'online';
export type LocationScope =
  | { mode: 'all' }
  | { mode: 'specific'; locations: string[] };
export type SortOption = 'az' | 'recent' | 'most-used';
export type PageFilters = {
  status?: Array<'active' | 'hidden'>;
  channelVisibility?: Array<'dine-in' | 'online'>;
  createdBy?: Array<'me' | 'others'>;
  dateRange?: '7d' | '30d' | 'all';
};

export type ScopeContextValue = {
  location: LocationScope;
  setLocation: (next: LocationScope) => void;
  channel: ChannelScope;
  setChannel: (next: ChannelScope) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  sort: SortOption;
  setSort: (s: SortOption) => void;
  filters: PageFilters;
  setFilters: (f: PageFilters) => void;
  activeLocationId: string | null;
  setActiveLocationId: (id: string | null) => void;
};

const ScopeContext = createContext<ScopeContextValue | undefined>(undefined);
const STORAGE_KEY = 'scope:activeLocationId';

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuthContext();

  // Per-session/tenant-ish channel storage key (no TS errors)
  const CHANNEL_KEY = useMemo(
    () => `scope:channel:${token ?? 'anon'}`,
    [token]
  );

  // Hydrate initial selection synchronously from localStorage
  const [location, setLocation] = useState<LocationScope>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (saved && saved.trim()) {
        return { mode: 'specific', locations: [saved] };
      }
    } catch {}
    return { mode: 'all' };
  });

  // Channel: per key; default to 'all'
  const [channel, setChannel] = useState<ChannelScope>('all');

  // Rehydrate channel whenever key changes
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(CHANNEL_KEY) : null;
      if (saved === 'dine-in' || saved === 'online' || saved === 'all') {
        setChannel(saved as ChannelScope);
      } else {
        setChannel('all');
      }
    } catch {
      setChannel('all');
    }
  }, [CHANNEL_KEY]);

  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('az');
  const [filters, setFilters] = useState<PageFilters>({});

  const activeLocationId =
    location.mode === 'specific' && location.locations.length > 0 ? location.locations[0] : null;

  const setActiveLocationId = (id: string | null) => {
    if (id && id.trim()) {
      setLocation({ mode: 'specific', locations: [id] });
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {}
    } else {
      setLocation({ mode: 'all' });
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
  };

  // Persist when setLocation is used directly
  useEffect(() => {
    try {
      if (activeLocationId) localStorage.setItem(STORAGE_KEY, activeLocationId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [activeLocationId]);

  // Persist channel per key
  useEffect(() => {
    try {
      localStorage.setItem(CHANNEL_KEY, channel);
    } catch {}
  }, [channel, CHANNEL_KEY]);

  const value = useMemo<ScopeContextValue>(
    () => ({
      location,
      setLocation,
      channel,
      setChannel,
      searchQuery,
      setSearchQuery,
      sort,
      setSort,
      filters,
      setFilters,
      activeLocationId,
      setActiveLocationId,
    }),
    [location, channel, searchQuery, sort, filters, activeLocationId]
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope must be used within a ScopeProvider');
  return ctx;
}