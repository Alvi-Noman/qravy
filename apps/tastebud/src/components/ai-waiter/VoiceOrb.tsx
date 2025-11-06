// apps/tastebud/src/components/ai-waiter/VoiceOrb.tsx
import React, { useEffect, useRef, useState } from "react";

type OrbMode = "idle" | "listening" | "thinking" | "talking";

type Props = {
  mode?: OrbMode;
  size?: number;
  className?: string;
  /** start → mid → end gradient */
  gradientStops?: [string, string, string];
  /** breathing depth when NOT listening (0–0.12 feels good) */
  breatheStrength?: number;
  /** breathing speed multiplier */
  speed?: number;
  /** 0..1 mic level (AiWaiterHome passes level when listening, 0 otherwise) */
  level?: number;
};

export default function VoiceOrb({
  mode,
  size = 300,
  className = "",
  gradientStops = ["#FFD4DA", "#FF8EA3", "#FA2851"],
  breatheStrength = 0.05,
  speed = 1,
  level = 0,
}: Props) {
  const [localMode, setLocalMode] = useState<OrbMode>("idle");
  const state = (mode ?? localMode) as OrbMode;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Keep latest mic level without re-rendering
  const levelRef = useRef(0);
  useEffect(() => {
    levelRef.current = Math.max(0, Math.min(1, level || 0));
  }, [level]);

  // One-pole attack/decay smoother
  const smoothRef = useRef(0);

  const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const baseRadius = Math.min(size, size) * 0.22;

    let t = 0;
    let last = performance.now();

    const draw = () => {
      const now = performance.now();
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05;

      t += dt;

      const isIdle = state === "idle";
      const isListening = state === "listening";
      const isTalking = state === "talking";
      const isThinking = state === "thinking";

      // ----- Radius calculation -----
      let r: number;
      if (isListening) {
        // Stop breathing and follow mic level smoothly.
        const target = levelRef.current;
        const prev = smoothRef.current;
        const attack = 12.0; // fast rise
        const decay = 4.0;   // slower fall
        const k = target > prev ? attack : decay;
        const smoothed = prev + (target - prev) * (1 - Math.exp(-k * dt));
        smoothRef.current = smoothed;

        const eased = easeOutCubic(smoothed);
        const voiceAmp = 0.30; // bigger but smooth
        const voiceScale = 1 + eased * voiceAmp;

        r = baseRadius * voiceScale;
      } else if (isIdle) {
        // Idle: NO breathing — fixed size
        r = baseRadius;
        smoothRef.current *= Math.exp(-6 * dt);
      } else if (isThinking) {
        // Gentle breathing only for thinking
        const pulse = 1 + Math.sin(t * 2.2 * speed) * breatheStrength;
        r = baseRadius * pulse;
        smoothRef.current *= Math.exp(-6 * dt);
      } else {
        // Fallback: fixed
        r = baseRadius;
        smoothRef.current *= Math.exp(-6 * dt);
      }

      // ----- Render core circle -----
      ctx.clearRect(0, 0, size, size);

      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, gradientStops[0]);
      g.addColorStop(0.5, gradientStops[1]);
      g.addColorStop(1, gradientStops[2]);

      // When talking, draw concentric "audio-wave" rings around the orb,
      // mirroring your inspiration (time-based waves, subtle alpha).
      if (isTalking) {
        // Slight core pulse (very subtle)
        const corePulse = 1 + Math.sin(t * 1.5) * 0.02;
        const coreR = r * corePulse;

        // Draw four expanding rings
        const waveSpeed = 1.2;
        const waveCount = 4;
        const wavePeriod = 3; // modulo domain
        const inc = size * (22 / 300); // ~22px when size=300 (scales with size)
        const strokeW = Math.max(0.6, size * (0.9 / 300)); // ~0.9px at 300

        for (let i = 0; i < waveCount; i++) {
          const wave = (t * waveSpeed + i * 1.5) % wavePeriod;
          const waveRadius = coreR + wave * inc;
          const alpha = 1 - wave / wavePeriod;

          ctx.beginPath();
          ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(250, 40, 81, ${alpha * 0.12})`;
          ctx.lineWidth = strokeW;
          ctx.stroke();
        }

        // Soft outer fill behind (matches inspiration outerRadius)
        const randomBounce =
          1 + (Math.sin(t * 10) + Math.sin(t * 14.7) + Math.sin(t * 20.2)) * 0.05;
        const outerRadius = coreR * randomBounce * 1.1;

        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#FFE1E6';
        ctx.fill();

        // Core gradient circle
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      } else {
        // Normal fill when not in talking waves mode
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [size, gradientStops, breatheStrength, speed, state]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} />
      {!mode && (
        <div className="mt-4 flex gap-3 justify-center">
          {(["idle", "listening", "thinking", "talking"] as OrbMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setLocalMode(m)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                localMode === m ? "bg-rose-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
