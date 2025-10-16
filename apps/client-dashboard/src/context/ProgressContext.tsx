/**
 * Global progress context for topbar loader
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';

export type ProgressContextValue = {
  start: () => void;
  done: () => void;
  active: boolean;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const countRef = useRef(0);
  const [active, setActive] = useState(false);

  const start = useCallback(() => {
    countRef.current += 1;
    if (countRef.current === 1) setActive(true);
  }, []);

  const done = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current === 0) setActive(false);
  }, []);

  return <ProgressContext.Provider value={{ start, done, active }}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error('useProgress must be used within ProgressProvider');
  return ctx;
}