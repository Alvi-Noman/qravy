// apps/tastebud/src/components/ai-waiter/AnimatedWords.tsx
// Text that arrives word by word: each new word blurs into focus, rises a little, and cools from brand pink to ink
// (see `qv-word-in` in index.css). Words already shown never animate again — a reply that grows as it's spoken only
// animates its new words; a different text starts fresh.
import React from 'react';

export default function AnimatedWords({ text }: { text: string }) {
  const gen = React.useRef(0);
  const prev = React.useRef('');
  if (!text.startsWith(prev.current)) gen.current += 1;
  prev.current = text;

  // freeze each word's delay the first time it's seen, so re-renders never restart its animation
  const delays = React.useRef<Map<string, number>>(new Map());
  let fresh = 0;
  return (
    <>
      {text.split(/(\s+)/).map((p, i) => {
        if (!p || /^\s+$/.test(p)) return p;
        const key = `${gen.current}-${i}`;
        if (!delays.current.has(key)) delays.current.set(key, Math.min(fresh++ * 55, 900));
        return (
          <span
            key={key}
            className="qv-motion inline-block"
            style={{ animation: `qv-word-in 900ms cubic-bezier(.2,.8,.2,1) ${delays.current.get(key)}ms both` }}
          >
            {p}
          </span>
        );
      })}
    </>
  );
}
