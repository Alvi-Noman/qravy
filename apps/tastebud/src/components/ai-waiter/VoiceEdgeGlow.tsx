// apps/tastebud/src/components/ai-waiter/VoiceEdgeGlow.tsx
// While the mic is OPEN, the screen's edges glow (like Siri's edge light) and breathe with the guest's voice — on
// every screen, over the sheets too, never blocking a tap. Mic closed → no glow: the glow means "I'm listening".
import React from 'react';

export default function VoiceEdgeGlow({ on, level }: { on: boolean; level: number }) {
  const spread = 10 + Math.min(1, level) * 26;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1640] transition-opacity duration-300"
      style={{
        opacity: on ? 1 : 0,
        boxShadow: `inset 0 0 ${spread}px ${Math.round(spread / 5)}px rgba(250, 40, 81, 0.55), inset 0 0 ${spread * 3}px rgba(124, 58, 237, 0.22)`,
        animation: on ? 'qv-glow 2.4s ease-in-out infinite' : undefined,
      }}
    >
      <style>{`@keyframes qv-glow { 0%,100% { filter: hue-rotate(0deg) } 50% { filter: hue-rotate(-25deg) } }`}</style>
    </div>
  );
}
