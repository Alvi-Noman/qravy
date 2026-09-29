// apps/tastebud/src/components/ai-waiter/VoiceEdgeGlow.tsx
// While the mic is OPEN, a soft light sits on the screen's edge in Qravy's own colours (the orb's gradient:
// brand red → rose → blush), drifting slowly and breathing a little with the guest's voice. Deliberately quiet —
// a thin, low-opacity band, not a frame. On every screen, over the sheets, never blocking a tap. Mic closed → no
// light. Reduced motion → it holds still.
import React from 'react';

export default function VoiceEdgeGlow({ on, level }: { on: boolean; level: number }) {
  const lv = Math.max(0, Math.min(1, level));
  const band = Math.round(12 + lv * 12); // the soft band (px): 12 px, up to 24 px while speaking
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1640] transition-opacity duration-700"
      style={{ opacity: on ? 1 : 0 }}
    >
      {/* a soft glow, low opacity */}
      <div className="qv-edge absolute inset-0" style={{ padding: band, filter: 'blur(10px)', opacity: 0.55 }} />
      {/* a hairline right at the edge */}
      <div className="qv-edge absolute inset-0" style={{ padding: 2, opacity: 0.45 }} />
      <style>{`
        @property --qv-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
        .qv-edge {
          /* Qravy's colours only: brand red → rose → blush, softly */
          background: conic-gradient(from var(--qv-a), #FA2851, #FF6B85, #FF8EA3, #FFC2CC, #FF8EA3, #FF6B85, #FA2851);
          /* only the band along the edge shows: the padding box minus the content box */
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          animation: qv-drift 10s linear infinite;
          transition: padding 160ms ease-out;
        }
        @keyframes qv-drift { to { --qv-a: 360deg; } }
        @media (prefers-reduced-motion: reduce) { .qv-edge { animation: none; } }
      `}</style>
    </div>
  );
}
