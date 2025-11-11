import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AiReplyMeta } from "../types/waiter-intents";

type ConversationState = {
  /** Authoritative, finalized AI text (what we keep across pages) */
  aiText: string;
  /** Live, word-by-word text revealed while TTS is speaking */
  aiTextLive: string;

  /** Last full AI meta payload from backend (includes decision, items, etc.) */
  lastMeta: AiReplyMeta | null;

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

  /** Store the latest meta object from AI Waiter backend */
  setMeta: (meta: AiReplyMeta | null) => void;
  /** Clear stored meta (e.g. on new session) */
  clearMeta: () => void;

  /** Utility: last N sentences from final buffer */
  getLastLines: (n: number) => string;
};

const DBG = (...args: any[]) => {
  // keep logs cheap; toggle here if you need to silence
  // eslint-disable-next-line no-console
  console.debug("[ConvStore]", ...args);
};

// ---- Factory so we can reuse the same store across HMR (prevents loops) ----
function createConversationStore() {
  DBG("createConversationStore()");
  const store = create<ConversationState>()(
    persist(
      (set, get) => ({
        aiText: "",
        aiTextLive: "",
        lastMeta: null,

        appendAi: (chunk) => {
          if (!chunk) return;
          const prev = get().aiText;
          const next = (prev ? prev + " " : "") + chunk;
          DBG("appendAi()", { chunk, prev, next: next.trim() });
          set({ aiText: next.trim() });
        },

        setAi: (text) => {
          DBG("setAi()", { text });
          set({ aiText: (text || "").trim() });
        },

        clearAi: () => {
          DBG("clearAi() -> reset aiText & aiTextLive");
          set({ aiText: "", aiTextLive: "" });
        },

        startTtsReveal: (original) => {
          DBG("startTtsReveal()", {
            originalPreview: String(original ?? "").slice(0, 80),
          });
          set({ aiTextLive: "" });
        },

        appendTtsReveal: (token) => {
          if (!token) return;
          const curr = get().aiTextLive;

          // Normalize token to string
          const t = String(token);

          // Punctuation sets that should *not* get a leading space
          const noLeadSpace = new Set([",", ".", "!", "?", ":", ";", ")", "’", "”", "।"]);
          // Opening quotes/brackets that shouldn't have trailing space before them
          const noTrailSpace = new Set(["(", "“", "‘"]); // reserved for future rules

          const needsLead =
            curr.length === 0
              ? false
              : !noLeadSpace.has(t);

          const sepLead = needsLead ? " " : "";
          const nextRaw = curr + sepLead + t;

          // Ensure a space AFTER comma or Bangla danda; remove stray spaces before closing punct
          const normalized = nextRaw
            .replace(/\s+([,.:;!?)]|।)/g, "$1") // remove space before closing punctuation
            .replace(/([,]|।)(?!\s)/g, "$1 "); // ensure space after comma or danda

          DBG("appendTtsReveal()", {
            token: t,
            needsLead,
            beforeLen: curr.length,
            afterLen: normalized.length,
            preview: normalized.slice(-80),
          });

          set({ aiTextLive: normalized });
        },

        finishTtsReveal: () => {
          const finalBefore = get().aiText;
          const live = get().aiTextLive;
          const merged = [finalBefore, live]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          DBG("finishTtsReveal()", {
            finalBeforePreview: finalBefore.slice(-80),
            livePreview: live.slice(0, 120),
            mergedPreview: merged.slice(-120),
          });

          set({ aiText: merged, aiTextLive: "" });
        },

        setMeta: (meta) => {
          DBG("setMeta()", {
            hasMeta: !!meta,
            intent: meta?.intent,
            decision: meta?.decision,
          });
          set({ lastMeta: meta });
        },

        clearMeta: () => {
          DBG("clearMeta()");
          set({ lastMeta: null });
        },

        getLastLines: (n) => {
          const raw = get().aiText || "";
          const parts = raw
            .replace(/\s+/g, " ")
            .trim()
            .split(/(?<=[.!?।])\s+/);
          const out = parts.slice(-n).join(" ");
          DBG("getLastLines()", {
            n,
            outPreview: out.slice(0, 120),
          });
          return out;
        },
      }),
      {
        name: "qravy-conversation",
        // Persist only what should survive navigation: final text + lastMeta.
        partialize: (s) => ({
          aiText: s.aiText,
          lastMeta: s.lastMeta,
        }),
        storage: createJSONStorage(() => {
          DBG("createJSONStorage(sessionStorage)");
          return sessionStorage;
        }),
        version: 2,
        onRehydrateStorage: () => {
          DBG("onRehydrateStorage -> start");
          return (state, error) => {
            if (error) {
              console.warn("[ConvStore] rehydrate error", error);
            } else {
              DBG("onRehydrateStorage -> done", {
                aiTextPreview: (state?.aiText || "").slice(0, 120),
                hasMeta: !!state?.lastMeta,
              });
            }
          };
        },
      }
    )
  );

  // Small dev helper to inspect current store values in console:
  if (typeof window !== "undefined") {
    (window as any).__qravyConvDump = () => {
      const s = store.getState();
      // eslint-disable-next-line no-console
      console.log("[ConvStore] dump", {
        aiTextLen: s.aiText.length,
        aiTextLiveLen: s.aiTextLive.length,
        aiTextTail: s.aiText.slice(-140),
        aiTextLiveTail: s.aiTextLive.slice(-140),
        hasMeta: !!s.lastMeta,
        metaIntent: s.lastMeta?.intent,
        metaDecision: s.lastMeta?.decision,
      });
    };
    DBG("Dev helper available: window.__qravyConvDump()");
  }

  return store;
}

// Reuse one store instance during Vite HMR to avoid multiple subscriptions/snapshots
let _store: ReturnType<typeof createConversationStore> | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __QRAVY_CONVERSATION_STORE__: ReturnType<typeof createConversationStore> | undefined;
}

if (typeof window !== "undefined" && import.meta && import.meta.hot) {
  const w = window as any;
  _store = w.__QRAVY_CONVERSATION_STORE__ ?? createConversationStore();
  w.__QRAVY_CONVERSATION_STORE__ = _store;
  DBG("HMR store reuse active");
} else {
  _store = createConversationStore();
}

export const useConversationStore = _store!;
