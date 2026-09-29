// apps/tastebud/src/components/ai-waiter/AssistantHeader.tsx
// The waiter's presence at the top of a sheet (the cards, the tray): the live orb on the left — room around it to
// breathe (its rings draw into the margin) — then "AI Assistant" and what it's doing right now, left-aligned, like
// a chat header (avatar · name · status). Tap it to pause / resume the conversation. The "which one?" answers sit
// right under it.
import React from 'react';
import VoiceOrb from './VoiceOrb';
import type { ChooseOption } from '../../utils/handsfree';

type OrbMode = 'idle' | 'listening' | 'thinking' | 'talking';

type Props = {
  mode: OrbMode;
  level: number;
  paused: boolean;
  lang: 'bn' | 'en';
  status: string; // "শুনছি… বলুন" / "ভাবছি…" / "বলছি…" / "থামানো — ট্যাপ করে বলুন"
  onToggle: () => void;
  choices?: ChooseOption[];
  onChoose?: (say: string) => void;
};

const ORB = 80; // canvas; the ball is ~44% (~35 px) — the rest is its rings' breathing room

export default function AssistantHeader({ mode, level, paused, lang, status, onToggle, choices, onChoose }: Props) {

  const micOpen = !paused && mode === 'listening';
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        aria-label={paused ? 'Resume talking' : 'Pause the mic'}
        className="group flex min-w-0 items-center gap-3 rounded-2xl pr-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
      >
        {/* the orb, with space to breathe */}
        <span className="relative h-14 w-14 shrink-0">
          <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <VoiceOrb mode={paused ? 'idle' : mode} size={ORB} level={micOpen ? level : 0} />
          </span>
          {paused && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow ring-1 ring-rose-100">
              <svg className="h-3.5 w-3.5 text-[#FA2851]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C10.34 2 9 3.34 9 5V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V5C15 3.34 13.66 2 12 2Z" />
                <path d="M19 11C19 14.53 16.39 17.44 13 17.93V21H11V17.93C7.61 17.44 5 14.53 5 11H7C7 13.76 9.24 16 12 16C14.76 16 17 13.76 17 11H19Z" />
              </svg>
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-tight text-gray-900">AI Assistant</span>
          <span
            role="status"
            aria-live="polite"
            className={`mt-0.5 block truncate text-[13px] leading-tight ${micOpen ? 'font-medium text-[#FA2851]' : 'text-gray-500'}`}
          >
            {status}
          </span>
        </span>
      </button>

      {/* "which one?" — one tap answers */}
      {choices && choices.length > 0 && onChoose && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Choose one">
          {choices.map((c) => (
            <button
              key={c.say}
              type="button"
              onClick={() => onChoose(c.say)}
              className="max-w-full truncate rounded-full border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-800 shadow-sm active:scale-95"
            >
              {c.label}
              {typeof c.price === 'number' && <span className="ml-1.5 font-normal text-gray-500">৳{c.price}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
