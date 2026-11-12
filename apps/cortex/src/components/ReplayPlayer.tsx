// apps/cortex/src/components/ReplayPlayer.tsx — a guest visit's session recording, played back (rrweb-player).
// The storefront records the page itself, not a video (apps/tastebud/src/utils/replay.ts): the player rebuilds it
// here, at the guest's screen size, scaled to fit. Typed text shows as ****; the guest's own details are masked.
import { useEffect, useRef, useState } from 'react';

type RrEvent = { type: number; timestamp: number };
export type ReplayHandle = { goto: (offsetMs: number, play?: boolean) => void; start: number };

export default function ReplayPlayer({ events, onReady }: { events: RrEvent[]; onReady?: (h: ReplayHandle | null) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || events.length < 2) return;
    let player: { $destroy: () => void; goto: (t: number, play?: boolean) => void } | null = null;
    let gone = false;
    // the player (and its styles) load only when a recording is opened
    Promise.all([import('rrweb-player'), import('rrweb-player/dist/style.css')])
      .then(([mod]) => {
        if (gone) return;
        const Player = mod.default;
        el.innerHTML = '';
        const width = Math.max(320, Math.min(el.clientWidth, 1100));
        player = new Player({
          target: el,
          props: {
            events: events as never,
            width,
            height: Math.round(Math.min(720, Math.max(480, width * 0.62))),
            autoPlay: false,
            skipInactive: true, // the quiet stretches (reading the menu, the phone in a pocket) are skipped
            speedOption: [1, 2, 4, 8],
            showController: true,
          },
        }) as unknown as typeof player;
        onReady?.({ goto: (t, play = true) => player?.goto(Math.max(0, t), play), start: events[0].timestamp });
      })
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : 'The player could not load'));
    return () => {
      gone = true;
      onReady?.(null);
      try {
        player?.$destroy();
      } catch {
        /* already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  if (failed) return <p className="text-[13px] text-rose-600">{failed}</p>;
  return <div ref={box} className="replay-box flex w-full justify-center overflow-hidden" />;
}
