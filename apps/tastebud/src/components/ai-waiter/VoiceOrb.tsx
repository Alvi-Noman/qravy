import React, { useEffect, useRef, useState } from "react";

type OrbMode = "idle" | "listening" | "thinking" | "talking";

type Props = {
  mode?: OrbMode;
  size?: number;
  className?: string;
  /** start → mid → end gradient */
  gradientStops?: [string, string, string];
  /** breathing depth for thinking (0–0.12 feels good) */
  breatheStrength?: number;
  /** global speed multiplier for non-talking states */
  speed?: number;
  /** 0..1 mic level; only used in 'listening' */
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // ----- live params in refs so the draw loop never restarts -----
  const stateRef = useRef<OrbMode>(mode ?? localMode);
  useEffect(() => { stateRef.current = (mode ?? localMode) as OrbMode; }, [mode, localMode]);

  const levelRef = useRef(0);
  useEffect(() => { levelRef.current = Math.max(0, Math.min(1, level || 0)); }, [level]);

  const breatheRef = useRef(breatheStrength);
  useEffect(() => { breatheRef.current = breatheStrength; }, [breatheStrength]);

  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // smoother for listening
  const smoothRef = useRef(0);
  const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

  // persistent time
  const tRef = useRef(0);
  const lastRef = useRef(performance.now());

  // ---- graceful ring exit (already added) ----
  const prevStateRef = useRef<OrbMode>(stateRef.current);
  const talkFadeRef = useRef(0);           // 0..1 fade amount during exit
  const talkFadeStartRef = useRef(0);      // t (seconds) when exit fade started
  const TALK_FADE_MS = 700;

  // ---- NEW: graceful ring entry ----
  const talkIntroRef = useRef(0);          // 0..1 fade amount during entry
  const talkIntroStartRef = useRef(0);     // t (seconds) when entry started
  const TALK_INTRO_MS = 450;

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
    const baseRadius = size * 0.22; // matches layout

    const createGrad = (r: number) => {
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, gradientStops[0]);
      g.addColorStop(0.5, gradientStops[1]);
      g.addColorStop(1, gradientStops[2]);
      return g;
    };

    const draw = () => {
      const now = performance.now();
      let dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (dt > 0.05) dt = 0.05;

      // advance persistent time
      tRef.current += dt;
      const t = tRef.current;

      // detect transitions for entry/exit fades
      const curr = stateRef.current;
      const prev = prevStateRef.current;

      // entry: not-talking -> talking
      if (prev !== "talking" && curr === "talking") {
        talkIntroRef.current = 0;          // start from invisible rings
        talkIntroStartRef.current = t;
        talkFadeRef.current = 0;           // cancel any tail if it existed
      }
      // exit: talking -> not-talking
      if (prev === "talking" && curr !== "talking") {
        talkFadeRef.current = 1;           // start exit tail at full
        talkFadeStartRef.current = t;
        talkIntroRef.current = 0;          // no intro while exiting
      }
      prevStateRef.current = curr;

      // evolve entry fade (only while talking)
      if (curr === "talking" && talkIntroRef.current < 1) {
        const elapsed = (t - talkIntroStartRef.current) * 1000;
        const lin = Math.max(0, Math.min(1, elapsed / TALK_INTRO_MS));
        // ease-out for a soft start
        talkIntroRef.current = 1 - Math.pow(1 - lin, 2);
      }

      // evolve exit fade (only while not talking)
      if (talkFadeRef.current > 0 && curr !== "talking") {
        const elapsed = (t - talkFadeStartRef.current) * 1000;
        const lin = Math.max(0, 1 - elapsed / TALK_FADE_MS);
        // ease-in for a soft end
        talkFadeRef.current = lin * lin;
      }

      const isIdle = curr === "idle";
      const isListening = curr === "listening";
      const isThinking = curr === "thinking";
      const isTalking = curr === "talking";
      const ringTail = !isTalking && talkFadeRef.current > 0; // fading tail active

      // ---- compute core radius per state ----
      let r: number = baseRadius;

      if (isListening) {
        const target = levelRef.current;
        const prevS = smoothRef.current;
        const attack = 12.0;
        const decay = 4.0;
        const k = target > prevS ? attack : decay;
        const smoothed = prevS + (target - prevS) * (1 - Math.exp(-k * dt));
        smoothRef.current = smoothed;
        const eased = easeOutCubic(smoothed);
        const voiceAmp = 0.28;
        r = baseRadius * (1 + eased * voiceAmp);
      } else if (isThinking) {
        const pulse = 1 + Math.sin(t * 1.5 * (speedRef.current || 1)) * (breatheRef.current || 0.05);
        r = baseRadius * pulse;
        smoothRef.current *= Math.exp(-6 * dt);
      } else if (isTalking) {
        const pulse = 1 + Math.sin(t * 1.5) * 0.02;
        r = baseRadius * pulse;
        smoothRef.current *= Math.exp(-6 * dt);
      } else {
        r = baseRadius;
        smoothRef.current *= Math.exp(-6 * dt);
      }

      // ---- render ----
      ctx.clearRect(0, 0, size, size);

      // Helper to draw the four thin rings (bottom layer)
      const drawThinRings = (coreR: number, alphaScale: number) => {
        if (alphaScale <= 0) return;
        const waveSpeed = 1.2;
        const waveCount = 4;
        const wavePeriod = 3; // modulo
        const inc = size * (22 / 300);
        const strokeW = Math.max(0.9, size * (0.9 / 300));
        for (let i = 0; i < waveCount; i++) {
          const wave = (t * waveSpeed + i * 1.5) % wavePeriod;
          const waveRadius = coreR + wave * inc;
          const alpha = (1 - wave / wavePeriod) * 0.12 * alphaScale;
          ctx.beginPath();
          ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(250, 40, 81, ${alpha})`;
          ctx.lineWidth = strokeW;
          ctx.stroke();
        }
      };

      if (isTalking) {
        // *** TALKING: rings (bottom, fade-in) → blush (middle) → core (top) ***
        const corePulse = 1 + Math.sin(t * 1.5) * 0.02;
        const coreR = baseRadius * corePulse;

        // 1️⃣ rings at bottom with graceful entry
        drawThinRings(coreR, talkIntroRef.current);

        // 2️⃣ blush
        const randomBounce =
          1 + (Math.sin(t * 10) + Math.sin(t * 14.7) + Math.sin(t * 20.2)) * 0.05;
        const outerRadius = coreR * randomBounce * 1.10;
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#FFE1E6";
        ctx.fill();

        // 3️⃣ gradient core
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fillStyle = createGrad(coreR);
        ctx.fill();
      } else {
        // If we’re fading out from talking, draw the tail rings first (bottom), then normal orb
        if (ringTail) {
          const corePulse = 1 + Math.sin(t * 1.5) * 0.02;
          const coreR = baseRadius * corePulse;
          drawThinRings(coreR, talkFadeRef.current);
        }

        // normal filled orb for non-talking states
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = createGrad(r);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [size, gradientStops]); // minimal dependency

  return (
    <div className={className}>
      <canvas ref={canvasRef} />
      {!mode && (
        <div className="mt-4 flex gap-3 justify-center">
          {(["idle","listening","thinking","talking"] as OrbMode[]).map(m => (
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
