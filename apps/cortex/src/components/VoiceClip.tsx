// apps/cortex/src/components/VoiceClip.tsx — "▶ Listen": what the guest actually said in a turn (its audio, kept a
// few days by the AI waiter), next to what the speech-to-text heard. Loaded only when asked for.
import { useEffect, useState } from 'react';
import { voiceClipUrl } from '../api';

export default function VoiceClip({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'gone'>('idle');
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (url) return <audio controls autoPlay src={url} className="mt-1 h-8 w-full max-w-[320px]" />;
  if (state === 'gone') return <span className="ml-2 text-[12px] italic text-stone-400">recording no longer kept</span>;
  return (
    <button
      type="button"
      disabled={state === 'loading'}
      onClick={async () => {
        setState('loading');
        const u = await voiceClipUrl(id);
        if (u) setUrl(u);
        else setState('gone');
      }}
      className="ml-2 rounded-full border border-stone-300 px-2 py-0.5 text-[12px] text-stone-700 hover:bg-stone-50 disabled:opacity-50"
    >
      {state === 'loading' ? '…' : '▶ Listen'}
    </button>
  );
}
