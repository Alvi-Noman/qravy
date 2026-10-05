import { useState } from 'react';
import TenminOrb, { type OrbMode } from '../components/ai-waiter/TenminOrb';

const MODES: OrbMode[] = ['idle', 'thinking', 'talking'];

export default function TenminOrbDemo() {
  const [mode, setMode] = useState<OrbMode>('thinking');
  const [holding, setHolding] = useState(false);

  // Hold-to-talk is the listening state
  const shown: OrbMode = holding ? 'listening' : mode;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-[#FFF8FA] p-6">
      <TenminOrb mode={shown} size={220} />

      <div className="flex flex-wrap justify-center gap-2">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors ${
              shown === m ? 'bg-[#FA2851] text-white' : 'bg-white text-[#1F1F1F] hover:text-[#FA2851]'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <button
        onPointerDown={() => setHolding(true)}
        onPointerUp={() => setHolding(false)}
        onPointerLeave={() => setHolding(false)}
        onPointerCancel={() => setHolding(false)}
        className={`select-none rounded-full px-6 py-3 text-sm font-semibold transition-colors ${
          holding ? 'bg-[#FA2851] text-white' : 'bg-white text-[#FA2851]'
        }`}
      >
        {holding ? 'Listening…' : 'Hold to talk'}
      </button>
    </div>
  );
}
