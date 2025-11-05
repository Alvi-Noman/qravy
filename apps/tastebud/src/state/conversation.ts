import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ConversationState = {
  /** Authoritative, finalized AI text (what we keep across pages) */
  aiText: string;
  /** Live, word-by-word text revealed while TTS is speaking */
  aiTextLive: string;

  /** Append a new final AI reply chunk (legacy helper) */
  appendAi: (chunk: string) => void;
  /** Replace entire final text */
  setAi: (text: string) => void;
  /** Clear both final + live (new turn/session) */
  clearAi: () => void;

  /** Start a new TTS reveal (clears live buffer) */
  startTtsReveal: (originalText: string) => void;
  /** Append a word/token to the live buffer (spacing-aware) */
  appendTtsReveal: (str: string) => void;
  /** Finalize: copy live → final, then clear live */
  finishTtsReveal: () => void;

  /** Utility: last N sentences from final buffer */
  getLastLines: (n: number) => string;
};

// ---- Factory so we can reuse the same store across HMR (prevents loops) ----
function createConversationStore() {
  return create<ConversationState>()(
    persist(
      (set, get) => ({
        aiText: "",
        aiTextLive: "",

        appendAi: (chunk) => {
          if (!chunk) return;
          const next = (get().aiText ? get().aiText + " " : "") + chunk;
          set({ aiText: next.trim() });
        },

        setAi: (text) => set({ aiText: (text || "").trim() }),

        clearAi: () => set({ aiText: "", aiTextLive: "" }),

        startTtsReveal: (_original) => set({ aiTextLive: "" }),

        appendTtsReveal: (token) => {
          if (!token) return;
          const curr = get().aiTextLive;

          // Normalize token to string
          const t = String(token);

          // Punctuation sets that should *not* get a leading space
          const noLeadSpace = new Set([",", ".", "!", "?", ":", ";", ")", "’", "”", "।"]);
          // Opening quotes/brackets that shouldn't have trailing space before them
          const noTrailSpace = new Set(["(", "“", "‘"]); // kept for clarity/future use

          const needsLead =
            curr.length === 0
              ? false
              : !noLeadSpace.has(t);

          const sepLead = needsLead ? " " : "";
          const nextRaw = curr + sepLead + t;

          // Ensure a space AFTER comma or Bangla danda; remove stray spaces before closing punct
          const normalized = nextRaw
            .replace(/\s+([,.:;!?)]|।)/g, "$1")  // remove space before closing punctuation
            .replace(/([,]|।)(?!\s)/g, "$1 ");   // ensure space after comma or danda

          set({ aiTextLive: normalized });
        },

        finishTtsReveal: () => {
          const merged = [get().aiText, get().aiTextLive]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          set({ aiText: merged, aiTextLive: "" });
        },

        getLastLines: (n) => {
          const raw = get().aiText || "";
          const parts = raw.replace(/\s+/g, " ").trim().split(/(?<=[.!?।])\s+/);
          return parts.slice(-n).join(" ");
        },
      }),
      {
        name: "qravy-conversation",
        // Persist only the finalized text; live buffer is ephemeral/UI-only
        partialize: (s) => ({ aiText: s.aiText }),
        storage: createJSONStorage(() => sessionStorage),
        version: 1,
      }
    )
  );
}

// Reuse one store instance during Vite HMR to avoid multiple subscriptions/snapshots
let _store:
  | ReturnType<typeof createConversationStore>
  | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __QRAVY_CONVERSATION_STORE__: ReturnType<typeof createConversationStore> | undefined;
}

if (typeof window !== "undefined" && import.meta && import.meta.hot) {
  const w = window as any;
  _store = w.__QRAVY_CONVERSATION_STORE__ ?? createConversationStore();
  w.__QRAVY_CONVERSATION_STORE__ = _store;
} else {
  _store = createConversationStore();
}

export const useConversationStore = _store!;
