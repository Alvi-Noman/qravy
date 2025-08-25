// components/AIAssistantPanel.tsx
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  XMarkIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  AtSymbolIcon,
  PaperClipIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';

export default function AIAssistantPanel({
  open,
  onClose,
  width = 380,
}: {
  open: boolean;
  onClose: () => void;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          key="ai-panel"
          ref={ref}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="relative h-full border-l border-[#ececec] bg-white"
          style={{ width }}
          aria-label="AI Assistant"
        >
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#ececec] bg-white/95 px-3 py-2">
            <button type="button" className="inline-flex items-center gap-1.5 text-sm text-slate-800">
              <span className="font-medium">New conversation</span>
              <ChevronDownIcon className="h-4 w-4 text-slate-500" />
            </button>
            <div className="flex items-center gap-2">
              <button type="button" title="Open in new window" className="rounded-md p-1.5 hover:bg-[#f6f6f6]">
                <ArrowTopRightOnSquareIcon className="h-4 w-4 text-slate-600" />
              </button>
              <button type="button" title="Close" onClick={onClose} className="rounded-md p-1.5 hover:bg-[#f6f6f6]">
                <XMarkIcon className="h-5 w-5 text-slate-700" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex h-[calc(100%-48px)] flex-col">
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mt-8 flex flex-col items-center text-center">
                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white">AI</div>
                <div className="text-base font-semibold text-slate-900">Hey there</div>
                <div className="mt-1 text-[13px] text-slate-600">How can I help?</div>

                <div className="mt-6 flex max-w-full flex-wrap justify-center gap-2">
                  {['Write Instagram post for new combo', 'What’s new?', 'Suggest popular add-ons', 'Optimize checkout copy'].map(
                    (s) => (
                      <button
                        key={s}
                        type="button"
                        className="rounded-full border border-[#e5e5e5] px-3 py-1 text-[12px] text-slate-700 hover:bg-[#f6f6f6]"
                      >
                        {s}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Composer */}
            <div className="border-t border-[#ececec] p-3">
              <div className="rounded-xl bg-white p-2 shadow-[0_0_0_1px_#eaeaea,0_6px_24px_-12px_rgba(0,0,0,0.2)]">
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-2 px-1 pb-1 text-slate-500">
                    <AtSymbolIcon className="h-5 w-5" />
                    <PaperClipIcon className="h-5 w-5" />
                  </div>
                  <textarea
                    rows={1}
                    placeholder="Ask anything…"
                    className="min-h-[36px] w-full resize-none bg-transparent px-2 text-[14px] text-slate-800 placeholder-slate-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                    title="Send"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}