import { useEffect, useId, useRef, type CSSProperties } from "react";

export type OrbMode = "idle" | "listening" | "thinking" | "talking";
type Props = {
  mode?: OrbMode;
  size?: number;
  className?: string;
  level?: number;
};

// Same gradient as VoiceOrb
const STOPS = ["#FFD4DA", "#FF8EA3", "#FA2851"];

// Geometry in a 100x100 viewBox (room left around the orb for the ring)
const C = 50;
const R = 38;
const RING_DEG_PER_SEC = 110;
const LISTEN_SCALE = 0.8; // orb shrinks while listening

// Ring proportions measured from the reference, relative to the listening orb radius
const ORB_LISTEN_R = R * LISTEN_SCALE;
const RING_GAP = ORB_LISTEN_R * 0.104; // white space between orb and ring
const RING_W = ORB_LISTEN_R * 0.234;
const RING_R = ORB_LISTEN_R + RING_GAP + RING_W / 2;
const RING_LEN = 2 * Math.PI * RING_R;
// Visible head-to-tail gap is ~5°; the round caps eat RING_W of arc on top of that
const RING_GAP_LEN = (5 / 360) * RING_LEN + RING_W;

const EYE_W = 10;
const EYE_H = 21;
const EYE_Y = 47;
const EYE_LX = 39.25;
const EYE_RX = 60.75;

// Blink: fast close, brief hold, slower open
const CLOSE = 0.07;
const HOLD = 0.04;
const OPEN = 0.14;
const BLINK = CLOSE + HOLD + OPEN;
const DOUBLE_GAP = 0.09;

// Talking -> idle "doze off" (seconds / viewBox units)
const DOZE_CLOSE = 0.45;
const DOZE_SHRINK = 0.22;
const DOZE_SINK = 3;
const DOZE_SQUASH = 0.8;

const hasEyes = (m: OrbMode) => m === "thinking" || m === "talking";
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 0 = open, 1 = closed */
function singleBlink(e: number) {
  if (e < 0 || e >= BLINK) return 0;
  if (e < CLOSE) return easeIn(e / CLOSE);
  if (e < CLOSE + HOLD) return 1;
  return 1 - easeOut((e - CLOSE - HOLD) / OPEN);
}

// A closed eye flattens to a rounded bar this tall
const EYE_MIN_H = 2.2;

// Thinking: eyes rest mostly up-right, with small shifts and the odd glance straight up
const THINK_GAZE: Array<[number, number]> = [
  [5.5, -6],
  [6.5, -4.5],
  [4.5, -7],
  [6, -5.5],
];
const THINK_GAZE_UP: [number, number] = [1, -6.5];

// Talking waves: soft ripples spreading out from behind the orb
const WAVE_COUNT = 3;
const WAVE_PERIOD = 2.4;
const WAVE_SPREAD = 9;

export default function TenminOrb({ mode = "idle", size = 120, className = "" }: Props) {
  const uid = useId().replace(/:/g, "");
  const modeRef = useRef(mode);
  const initialEyes = useRef(hasEyes(mode)).current; // after mount the rAF loop owns eye opacity
  modeRef.current = mode;

  const ringRef = useRef<SVGGElement | null>(null);
  const bodyRef = useRef<SVGGElement | null>(null);
  const eyesRef = useRef<SVGGElement | null>(null);
  const leftEyeRef = useRef<SVGRectElement | null>(null);
  const rightEyeRef = useRef<SVGRectElement | null>(null);
  const waveRefs = useRef<Array<SVGCircleElement | null>>([]);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let raf = 0;
    const t0 = performance.now();

    let blinkStart = -1;
    let blinkDouble = false;
    let nextBlink = rand(1.2, 3);

    const gaze = { fx: 0, fy: 0, tx: 0, ty: 0, start: 0 };
    let gazeIdx = 0;
    let nextGaze = 0.4;
    let lastMode = modeRef.current;

    // Eye enter/exit transitions
    let eyesInStart = -1;
    let eyesOutStart = -1;
    let eyesOutDoze = false; // eyes -> idle: doze off instead of a plain fade

    const currentGaze = (t: number) => {
      const k = easeOutBack(Math.min(1, (t - gaze.start) / 0.2));
      return { x: gaze.fx + (gaze.tx - gaze.fx) * k, y: gaze.fy + (gaze.ty - gaze.fy) * k };
    };
    const lookAt = (t: number, x: number, y: number) => {
      const cur = currentGaze(t);
      Object.assign(gaze, { fx: cur.x, fy: cur.y, tx: x, ty: y, start: t });
    };
    const triggerBlink = (t: number) => {
      blinkStart = t;
      blinkDouble = Math.random() < 0.22;
      nextBlink = t + rand(2.4, 5.2);
    };

    let waveMix = modeRef.current === "talking" ? 1 : 0;
    let last = t0;

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = modeRef.current;
      const thinking = m === "thinking";

      const eyesNow = hasEyes(m);
      if (m !== lastMode) {
        const eyesBefore = hasEyes(lastMode);
        if (eyesBefore && !eyesNow) {
          eyesOutStart = t;
          eyesOutDoze = m === "idle";
        } else if (!eyesBefore && eyesNow) {
          eyesInStart = t;
          eyesOutStart = -1;
        } else if (m === "listening" && eyesOutDoze) {
          // hold-to-talk mid doze-off: no sleepy finish — the eyes just fade out
          eyesOutDoze = false;
          eyesOutStart = t;
        }
        lastMode = m;
        if (!thinking) lookAt(t, 0, 0);
        nextGaze = t + 0.15;
      }

      if (thinking && !reduce && t >= nextGaze) {
        const glanceUp = gazeIdx >= 0 && Math.random() < 0.18;
        if (glanceUp) {
          gazeIdx = -1;
        } else {
          gazeIdx = (Math.max(0, gazeIdx) + 1 + Math.floor(Math.random() * (THINK_GAZE.length - 1))) % THINK_GAZE.length;
        }
        const [gx, gy] = glanceUp ? THINK_GAZE_UP : THINK_GAZE[gazeIdx];
        lookAt(t, gx, gy);
        nextGaze = t + (glanceUp ? rand(0.6, 0.9) : rand(1.1, 2));
        if (Math.random() < 0.45 && (blinkStart < 0 || t - blinkStart > 0.6)) triggerBlink(t);
      }

      if (t >= nextBlink) triggerBlink(t);

      let closed = 0;
      if (blinkStart >= 0) {
        const e = t - blinkStart;
        closed = singleBlink(e);
        if (blinkDouble) closed = Math.max(closed, singleBlink(e - BLINK - DOUBLE_GAP) * 0.9);
      }

      let eyeOpacity = 1;
      let sink = 0;
      let sxMul = 1;
      let syMul = 1;
      let squash = 0;
      if (!eyesNow) {
        if (eyesOutStart < 0) {
          eyeOpacity = 0;
        } else if (eyesOutDoze) {
          // Doze off: slow sleepy close while sinking, then the slits shrink away
          const e = t - eyesOutStart;
          const p1 = clamp01(e / DOZE_CLOSE);
          const p2 = clamp01((e - DOZE_CLOSE) / DOZE_SHRINK);
          closed = Math.max(closed, easeInOut(p1));
          sink = DOZE_SINK * easeInOut(p1);
          sxMul = 1 - easeIn(p2);
          eyeOpacity = 1 - p2;
          // Exhale: soft squash that settles with a tiny rebound
          const ps = clamp01(e / DOZE_SQUASH);
          if (!reduce && ps < 1) squash = Math.sin(ps * Math.PI * 1.5) * (1 - ps);
        } else {
          eyeOpacity = 1 - clamp01((t - eyesOutStart) / 0.15);
        }
      } else if (eyesInStart >= 0) {
        // Pop open
        const e = t - eyesInStart;
        syMul = Math.max(0, easeOutBack(clamp01(e / 0.3)));
        eyeOpacity = clamp01(e / 0.08);
      }

      const g = currentGaze(t);
      // Size the eye itself (not a scale) so a closed eye is a flat rounded bar, not a pointed sliver
      const eh = Math.max(EYE_MIN_H, EYE_H * (1 - closed)) * syMul;
      const ew = EYE_W * (1 + closed * 0.12) * sxMul;
      const er = Math.min(ew, eh) / 2;

      // Talking waves fade in/out with the state
      waveMix += ((m === "talking" ? 1 : 0) - waveMix) * (1 - Math.exp(-dt * 6));
      for (let i = 0; i < WAVE_COUNT; i++) {
        const el = waveRefs.current[i];
        if (!el) continue;
        const p = reduce ? 0.35 : ((t / WAVE_PERIOD + i / WAVE_COUNT) % 1);
        el.setAttribute("r", (R + easeOut(p) * WAVE_SPREAD).toFixed(2));
        el.setAttribute("opacity", (Math.pow(1 - p, 1.4) * 0.3 * waveMix).toFixed(3));
      }

      const bsx = 1 + squash * 0.05;
      const bsy = 1 - squash * 0.07;
      bodyRef.current?.setAttribute(
        "transform",
        `translate(${C} ${C + R}) scale(${bsx.toFixed(4)} ${bsy.toFixed(4)}) translate(${-C} ${-(C + R)})`,
      );
      eyesRef.current?.setAttribute("opacity", eyeOpacity.toFixed(3));
      eyesRef.current?.setAttribute("transform", `translate(${g.x.toFixed(2)} ${(g.y + sink).toFixed(2)})`);
      for (const el of [leftEyeRef.current, rightEyeRef.current]) {
        if (!el) continue;
        el.setAttribute("x", (-ew / 2).toFixed(3));
        el.setAttribute("y", (-eh / 2).toFixed(3));
        el.setAttribute("width", ew.toFixed(3));
        el.setAttribute("height", eh.toFixed(3));
        el.setAttribute("rx", er.toFixed(3));
      }

      if (!reduce) ringRef.current?.setAttribute("transform", `rotate(${((t * RING_DEG_PER_SEC) % 360).toFixed(1)} ${C} ${C})`);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const bodyGrad = `orb-body-${uid}`;
  const ringGrad = `orb-ring-${uid}`;
  const waveBlur = `orb-wave-blur-${uid}`;
  const waveGrad = `orb-wave-${uid}`;
  const showRing = mode === "listening"; // hold-to-talk
  const orbStyle: CSSProperties = {
    transform: `scale(${showRing ? LISTEN_SCALE : 1})`,
    transformOrigin: `${C}px ${C}px`,
    transformBox: "view-box",
    transition: "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  };

  return (
    <div className={className} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" overflow="visible" role="img" aria-label={`Assistant ${mode}`}>
        <defs>
          <linearGradient id={bodyGrad} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={STOPS[0]} />
            <stop offset="50%" stopColor={STOPS[1]} />
            <stop offset="100%" stopColor={STOPS[2]} />
          </linearGradient>
          <linearGradient id={ringGrad} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={STOPS[2]} />
            <stop offset="100%" stopColor={STOPS[1]} />
          </linearGradient>
          <linearGradient id={waveGrad} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={STOPS[0]} />
            <stop offset="50%" stopColor={STOPS[1]} />
            <stop offset="100%" stopColor={STOPS[2]} />
          </linearGradient>
          <filter id={waveBlur} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1" />
          </filter>
        </defs>

        {/* Talking waves */}
        <g filter={`url(#${waveBlur})`}>
          {Array.from({ length: WAVE_COUNT }, (_, i) => (
            <circle
              key={i}
              ref={(el) => {
                waveRefs.current[i] = el;
              }}
              cx={C}
              cy={C}
              r={R}
              fill={`url(#${waveGrad})`}
              opacity={0}
            />
          ))}
        </g>

        {/* Listening (hold-to-talk) ring */}
        <g style={{ opacity: showRing ? 1 : 0, transition: "opacity 250ms ease" }}>
          <g ref={ringRef}>
            <circle
              cx={C}
              cy={C}
              r={RING_R}
              fill="none"
              stroke={`url(#${ringGrad})`}
              strokeWidth={RING_W}
              strokeLinecap="round"
              strokeDasharray={`${RING_LEN - RING_GAP_LEN} ${RING_GAP_LEN}`}
            />
          </g>
        </g>

        <g style={orbStyle}>
          <circle cx={C} cy={C} r={R + RING_GAP / LISTEN_SCALE} fill="#FFFFFF" style={{ opacity: showRing ? 1 : 0, transition: "opacity 250ms ease" }} />
          <g ref={bodyRef}>
            <circle cx={C} cy={C} r={R} fill={`url(#${bodyGrad})`} />

            <g ref={eyesRef} opacity={initialEyes ? 1 : 0}>
              <rect
                ref={leftEyeRef}
                x={-EYE_W / 2}
                y={-EYE_H / 2}
                width={EYE_W}
                height={EYE_H}
                rx={EYE_W / 2}
                fill="#FFFFFF"
                transform={`translate(${EYE_LX} ${EYE_Y})`}
              />
              <rect
                ref={rightEyeRef}
                x={-EYE_W / 2}
                y={-EYE_H / 2}
                width={EYE_W}
                height={EYE_H}
                rx={EYE_W / 2}
                fill="#FFFFFF"
                transform={`translate(${EYE_RX} ${EYE_Y})`}
              />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
