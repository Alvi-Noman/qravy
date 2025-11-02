// apps/tastebud/src/state/conversation.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ConversationState = {
  /** Full AI text buffer (what the backend has spoken so far) */
  aiText: string;

  /** Append a new final AI reply chunk */
  appendAi: (chunk: string) => void;

  /** Replace entire text (if you ever need to reset manually) */
  setAi: (text: string) => void;

  /** Clear everything (e.g. on new session) */
  clearAi: () => void;

  /** Get only the last N lines or sentences for compact display */
  getLastLines: (n: number) => string;
};

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      aiText: "",

      appendAi: (chunk) => {
        if (!chunk) return;
        const next = (get().aiText ? get().aiText + " " : "") + chunk;
        set({ aiText: next.trim() });
      },

      setAi: (text) => set({ aiText: text || "" }),

      clearAi: () => set({ aiText: "" }),

      getLastLines: (n) => {
        const raw = get().aiText || "";
        // Split into sentences by punctuation, fallback to spaces
        const parts = raw
          .replace(/\s+/g, " ")
          .trim()
          .split(/(?<=[.!?])\s+/);
        return parts.slice(-n).join(" ");
      },
    }),
    {
      name: "qravy-conversation",
      partialize: (s) => ({ aiText: s.aiText }),
      // ✅ Use a stable JSON storage to avoid HMR/multi-instance bugs and type errors
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
