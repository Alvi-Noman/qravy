// apps/tastebud/src/components/ai-waiter/MicHalo.tsx
import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type UIMode = 'idle' | 'listening' | 'talking';

interface MicHaloProps {
  size?: number;
  color?: string;
  accentColor?: string;
  opacity?: number;
  mode?: UIMode;
  level?: number;
}

export default function MicHalo({
  size = 600,
  color = '#FFE9ED',
  accentColor = '#FA2851',
  opacity = 0.6,
  mode = 'idle',
  level = 0,
}: MicHaloProps) {
  const clamped = Math.min(1, Math.max(0, level));

  const baseScale = useMemo(() => {
    if (mode === 'talking') return 1.0;
    if (mode === 'listening') return clamped < 0.06 ? 1.02 : 1.02 + clamped * 0.16;
    return 1.0;
  }, [mode, clamped]);

  const glowPx = useMemo(() => {
    if (mode === 'talking') return 8;
    if (mode === 'listening') return Math.min(24, 4 + clamped * 40);
    return 8;
  }, [mode, clamped]);

  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: 1,
  };

  return (
    <div style={containerStyle}>
      {/* Base breathing halo */}
      <motion.div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '9999px',
          background: color,
          opacity,
          boxShadow: `0 0 ${glowPx}px ${hexToRgba(accentColor, 0.15)}`,
          willChange: 'transform, box-shadow',
        }}
        animate={{
          scale: baseScale,
          boxShadow: `0 0 ${glowPx}px ${hexToRgba(accentColor, 0.25)}`,
        }}
        transition={{
          type: 'spring',
          stiffness: 120,
          damping: 18,
          mass: 0.6,
        }}
      />

      {/* Talking: animated rings + EQ bars */}
      <AnimatePresence>
        {mode === 'talking' && (
          <motion.div
            key="talking-rings"
            style={{ position: 'absolute', inset: 0 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {[0, 1, 2].map((i) => (
              <PulseRing
                key={i}
                delay={i * 0.45}
                duration={1.25}
                borderColor={accentColor}
              />
            ))}
            <EQBars level={clamped} accent={accentColor} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- subcomponents ---------- */

function PulseRing({
  delay = 0,
  duration = 1.2,
  borderColor = '#FA2851',
}: {
  delay?: number;
  duration?: number;
  borderColor?: string;
}) {
  return (
    <motion.div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        border: `2px solid ${hexToRgba(borderColor, 0.55)}`,
        willChange: 'transform, opacity',
      }}
      initial={{ scale: 1, opacity: 0 }}
      animate={{ 
        scale: [1, 1.8], 
        opacity: [0.6, 0],
      }}
      transition={{
        delay,
        duration,
        repeat: Infinity,
        ease: 'easeOut',
        times: [0, 1],
      }}
    />
  );
}

function EQBars({
  level = 0,
  accent = '#FA2851',
}: {
  level?: number;
  accent?: string;
}) {
  const bars = [0, 1, 2, 3, 4];
  const base = 18;
  const gain = Math.min(1, Math.max(0, level));
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'flex-end',
          height: 40,
        }}
      >
        {bars.map((i) => {
          const h = base + Math.sin((gain * Math.PI) + i * 0.8) * 16 + gain * 32;
          return (
            <motion.div
              key={i}
              style={{
                width: 4,
                borderRadius: 999,
                background: `linear-gradient(180deg, ${hexToRgba(accent, 0.9)}, ${hexToRgba(accent, 0.35)})`,
              }}
              animate={{ height: Math.max(8, h) }}
              transition={{ type: 'spring', stiffness: 220, damping: 20, mass: 0.4 }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------- utils ---------- */
function hexToRgba(hex: string, a = 1): string {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}