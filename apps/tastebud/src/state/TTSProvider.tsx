import React, { createContext, useContext, useMemo } from "react";
import { getTTS, type TTSPublicAPI } from "./tts";

const TTSContext = createContext<TTSPublicAPI | null>(null);

export function TTSProvider({ children }: { children: React.ReactNode }) {
  // Create the TTS API exactly once per app mount
  const api = useMemo(() => getTTS(), []);
  return <TTSContext.Provider value={api}>{children}</TTSContext.Provider>;
}

export function useTTS(): TTSPublicAPI {
  const ctx = useContext(TTSContext);
  if (!ctx) throw new Error("useTTS must be used inside <TTSProvider>");
  return ctx;
}
