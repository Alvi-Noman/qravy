// apps/tastebud/src/components/ai-waiter/VoiceOrb.tsx
import React, { useState, useEffect, useRef } from 'react';

type OrbMode = 'idle' | 'listening' | 'thinking' | 'talking';

type Props = {
  /** Controlled mode from parent. If omitted, the internal demo buttons can change it. */
  mode?: OrbMode;
  /** CSS pixels (logical) — component handles HiDPI internally. */
  size?: number;
  /** Extra className for the wrapper <div>. */
  className?: string;
};

export default function VoiceOrb({ mode, size = 300, className = '' }: Props) {
  const [localMode, setLocalMode] = useState<OrbMode>('idle');
  const state = (mode ?? localMode) as OrbMode;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const baseRadius = Math.min(size, size) * 0.2; // ~60 when size=300
    let time = 0;

    const drawOrb = () => {
      ctx.clearRect(0, 0, size, size);
      time += 0.016;

      if (state === 'idle') {
        drawIdle(ctx, centerX, centerY, time, baseRadius);
      } else if (state === 'listening') {
        drawListening(ctx, centerX, centerY, time, baseRadius);
      } else if (state === 'thinking') {
        drawThinking(ctx, centerX, centerY, time, baseRadius);
      } else if (state === 'talking') {
        drawTalking(ctx, centerX, centerY, time, baseRadius);
      }

      animationRef.current = requestAnimationFrame(drawOrb);
    };

    animationRef.current = requestAnimationFrame(drawOrb);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [state, size]);

  const createGradient = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) => {
    const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gradient.addColorStop(0, '#FFD4DA');
    gradient.addColorStop(0.5, '#FF8EA3');
    gradient.addColorStop(1, '#FA2851');
    return gradient;
  };

  const drawIdle = (ctx: CanvasRenderingContext2D, x: number, y: number, time: number, radius: number) => {
    const pulse = 1 + Math.sin(time * 1.5) * 0.03;
    const gradient = createGradient(ctx, x, y, radius * pulse);
    ctx.beginPath();
    ctx.arc(x, y, radius * pulse, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  };

  const drawListening = (ctx: CanvasRenderingContext2D, x: number, y: number, time: number, radius: number) => {
    // Realistic small bounce similar to talking but smoother (no halo)
    const randomBounce = 1 + (Math.sin(time * 9) + Math.sin(time * 12.3) + Math.sin(time * 15.7)) * 0.04;
    const gradient = createGradient(ctx, x, y, radius * randomBounce);
    ctx.beginPath();
    ctx.arc(x, y, radius * randomBounce, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  };

  const drawThinking = (ctx: CanvasRenderingContext2D, x: number, y: number, time: number, radius: number) => {
    const pulse = 1 + Math.sin(time * 1.5) * 0.03;
    const offsetX = Math.sin(time * 2) * 10;
    const offsetY = Math.cos(time * 2.3) * 10;
    const gradient = createGradient(ctx, x + offsetX, y + offsetY, radius * pulse);
    ctx.beginPath();
    ctx.arc(x, y, radius * pulse, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  };

  const drawTalking = (ctx: CanvasRenderingContext2D, x: number, y: number, time: number, radius: number) => {
    const pulse = 1 + Math.sin(time * 1.5) * 0.02;
    const randomBounce = 1 + (Math.sin(time * 10) + Math.sin(time * 14.7) + Math.sin(time * 20.2)) * 0.05;
    const outerRadius = radius * pulse * randomBounce * 1.1;

    for (let i = 0; i < 4; i++) {
      const wave = (time * 1.2 + i * 1.5) % 3;
      const waveRadius = radius * pulse + wave * 22;
      const alpha = 1 - wave / 3;

      ctx.beginPath();
      ctx.arc(x, y, waveRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(250, 40, 81, ${alpha * 0.12})`;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    // soft outer fill behind the orb
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#FFE1E6';
    ctx.fill();

    const gradient = createGradient(ctx, x, y, radius * pulse);
    ctx.beginPath();
    ctx.arc(x, y, radius * pulse, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  };

  return (
    <div className={className}>
      <canvas ref={canvasRef} />
      {/* If used standalone (no mode prop), show demo buttons to switch states */}
      {!mode && (
        <div className="mt-4 flex gap-3 justify-center">
          {(['idle','listening','thinking','talking'] as OrbMode[]).map(m => (
            <button
              key={m}
              onClick={() => setLocalMode(m)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                localMode === m ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
