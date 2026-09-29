// apps/tastebud/src/utils/earcon.ts
// Tiny, quiet sounds that say what the mic is doing without looking (voice-UI practice: pair a subtle sound cue
// with the visual state). "listen" = a soft rising two-note chime when the mic reopens by itself; "pause" = falling.
// Synthesised on the fly (no audio files); silent if audio isn't unlocked yet.

let ctx: AudioContext | null = null;

export function earcon(kind: 'listen' | 'pause'): void {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = ctx && ctx.state !== 'closed' ? ctx : new AC();
    const c = ctx as AudioContext;
    if (c.state === 'suspended') void c.resume();
    const now = c.currentTime + 0.01;
    const notes = kind === 'listen' ? [660, 990] : [740, 494];
    notes.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = now + i * 0.085;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + 0.15);
    });
  } catch {
    // no sound is fine
  }
}
