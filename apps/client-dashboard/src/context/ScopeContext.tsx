import { createContext, useContext, useMemo, useState } from 'react';

/** Channel filter values across the app. */
export type ChannelScope = 'all' | 'dine-in' | 'online';

/** Location selection model for global scope. */
export type LocationScope =
  | { mode: 'all' }
  | { mode: 'specific'; locations: string[] };

/** Sort options for the current page. */
export type SortOption = 'az' | 'recent' | 'most-used';

/** Filter options for the current page. */
export type PageFilters = {
  status?: Array<'active' | 'hidden'>;
  channelVisibility?: Array<'dine-in' | 'online'>;
  createdBy?: Array<'me' | 'others'>;
  dateRange?: '7d' | '30d' | 'all';
};

/** Public API of the global scope context. */
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
};

/** React context for global scope. */
const ScopeContext = createContext<ScopeContextValue | undefined>(undefined);

/** Provider for global scope values (location, channel, search, sort, filters). */
export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LocationScope>({ mode: 'all' });
  const [channel, setChannel] = useState<ChannelScope>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('az');
  const [filters, setFilters] = useState<PageFilters>({});

  const value = useMemo<ScopeContextValue>(
    () => ({ location, setLocation, channel, setChannel, searchQuery, setSearchQuery, sort, setSort, filters, setFilters }),
    [location, channel, searchQuery, sort, filters]
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

/** Hook to access the global scope context. */
export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope must be used within a ScopeProvider');
  return ctx;
}