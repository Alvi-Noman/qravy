import { createContext, useContext, useMemo, useState, useEffect } from 'react';

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
const CHANNEL_STORAGE_KEY = 'scope:channel';

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  // Hydrate initial selection synchronously from localStorage to avoid an initial "All" fetch
  const [location, setLocation] = useState<LocationScope>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (saved && saved.trim()) {
        return { mode: 'specific', locations: [saved] };
      }
    } catch {}
    return { mode: 'all' };
  });

  // Hydrate channel from localStorage (default to 'all')
  const [channel, setChannel] = useState<ChannelScope>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(CHANNEL_STORAGE_KEY) : null;
      if (saved === 'dine-in' || saved === 'online' || saved === 'all') return saved as ChannelScope;
    } catch {}
    return 'all';
  });

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

  // Persist channel
  useEffect(() => {
    try {
      localStorage.setItem(CHANNEL_STORAGE_KEY, channel);
    } catch {}
  }, [channel]);

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