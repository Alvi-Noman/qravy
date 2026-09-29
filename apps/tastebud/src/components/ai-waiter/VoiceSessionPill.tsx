// apps/tastebud/src/components/ai-waiter/VoiceSessionPill.tsx
// The hands-free conversation's one control, on every screen (home, the cards, the tray) — like Gemini Live's
// floating pill: what the waiter is doing right now (listening to you / thinking / speaking / paused), plus mute and
// end. The guest always knows whether the mic is open, and can stop it with one tap.
import React from 'react';
import type { ChooseOption } from '../../utils/handsfree';

export type VoiceState = 'listening' | 'hearing' | 'thinking' | 'speaking' | 'waiting' | 'paused';

type Props = {
  state: VoiceState;
  level: number; // 0..1 mic level (listening)
  lang: 'bn' | 'en';
  onMute: () => void;
  onResume: () => void;
  onEnd: () => void;
  /** "which one?" answers — shown under the pill while a sheet covers the home screen's own buttons */
  choices?: ChooseOption[];
  onChoose?: (say: string) => void;
};

const LABEL: Record<VoiceState, [string, string]> = {
  listening: ['শুনছি… বলুন', 'Listening… go ahead'],
  hearing: ['শুনছি…', 'Listening…'],
  thinking: ['ভাবছি…', 'Thinking…'],
  speaking: ['বলছি…', 'Speaking…'],
  waiting: ['এক মুহূর্ত…', 'One moment…'],
  paused: ['থামানো আছে — কথা বলতে ট্যাপ করুন', 'Paused — tap to talk'],
};

function Bars({ level, active }: { level: number; active: boolean }) {
  // five bars: live with the guest's voice while listening
  const shape = [0.55, 0.85, 1, 0.8, 0.5];
  return (
    <span className="flex h-5 items-center gap-[3px]" aria-hidden="true">
      {shape.map((s, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-white transition-[height] duration-100"
          style={{ height: `${active ? Math.max(4, Math.min(20, 4 + level * 30 * s)) : 4}px` }}
        />
      ))}
    </span>
  );
}

function Dots() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function Wave() {
  return (
    <span className="flex h-5 items-center gap-[3px]" aria-hidden="true">
      {[0, 120, 240, 360].map((d) => (
        <span
          key={d}
          className="w-[3px] rounded-full bg-white"
          style={{ height: 14, animation: 'qv-wave 0.9s ease-in-out infinite', animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

export default function VoiceSessionPill({ state, level, lang, onMute, onResume, onEnd, choices, onChoose }: Props) {
  const bn = lang === 'bn';
  const paused = state === 'paused';
  const micOpen = state === 'listening' || state === 'hearing';
  const bg = paused
    ? 'bg-gray-900/90'
    : micOpen
    ? 'bg-gradient-to-r from-[#FA2851] to-[#FF5470]'
    : 'bg-gray-900/90';

  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[1650] flex -translate-x-1/2 flex-col items-center gap-2"
      // below the top row (language switch, order pill) — and above the sheets, which start at 15% of the height
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)', width: 'min(92vw, 420px)' }}
    >
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex w-full items-center gap-3 rounded-full ${bg} py-2 pl-4 pr-2 text-white shadow-xl backdrop-blur-md transition-colors duration-300`}
      >
        {/* what's happening */}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15">
          {micOpen ? <Bars level={level} active /> : state === 'thinking' || state === 'waiting' ? <Dots /> : state === 'speaking' ? <Wave /> : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" d="M12 2a3 3 0 00-3 3v6a3 3 0 106 0V5a3 3 0 00-3-3zM19 11a7 7 0 01-14 0M12 18v4" />
            </svg>
          )}
        </span>
        {paused ? (
          <button type="button" onClick={onResume} className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
            {bn ? LABEL.paused[0] : LABEL.paused[1]}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{bn ? LABEL[state][0] : LABEL[state][1]}</span>
        )}

        {/* mute / resume */}
        <button
          type="button"
          onClick={paused ? onResume : onMute}
          aria-label={paused ? (bn ? 'আবার শুনুন' : 'Resume listening') : bn ? 'মাইক বন্ধ' : 'Mute mic'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 active:scale-95"
        >
          {paused ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" d="M12 2a3 3 0 00-3 3v6a3 3 0 106 0V5a3 3 0 00-3-3zM19 11a7 7 0 01-14 0M12 18v4" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" d="M9 5a3 3 0 016 0v4M15 13a3 3 0 01-5.1 2.1M19 11a7 7 0 01-1.1 3.8M5 11a7 7 0 0010.4 6.1M12 18v4M3 3l18 18" />
            </svg>
          )}
        </button>
        {/* end the conversation */}
        <button
          type="button"
          onClick={onEnd}
          aria-label={bn ? 'কথা শেষ' : 'End conversation'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 active:scale-95"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* "which one?" answers, one tap each (when a sheet covers the home screen's buttons) */}
      {choices && choices.length > 0 && onChoose && (
        <div className="pointer-events-auto flex max-w-full flex-wrap justify-center gap-2" role="group" aria-label="Choose one">
          {choices.map((c) => (
            <button
              key={c.say}
              type="button"
              onClick={() => onChoose(c.say)}
              className="max-w-full truncate rounded-full border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-800 shadow-md active:scale-95"
            >
              {c.label}
              {typeof c.price === 'number' && <span className="ml-1.5 font-normal text-gray-500">৳{c.price}</span>}
            </button>
          ))}
        </div>
      )}

      <style>{`@keyframes qv-wave { 0%,100% { transform: scaleY(0.35) } 50% { transform: scaleY(1) } }`}</style>
    </div>
  );
}
