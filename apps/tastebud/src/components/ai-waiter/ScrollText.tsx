// apps/tastebud/src/components/ai-waiter/ScrollText.tsx
// What the waiter says, in a box of fixed height (N lines) that the guest can drag / wheel to read back. It follows
// the newest words as they arrive — unless the guest has scrolled up to read; scrolling back to the bottom (or a new
// reply) makes it follow again. Short text sits centered in the box. Soft fades show there's more above / below.
import React from 'react';
import AnimatedWords from './AnimatedWords';

type Props = {
  text: string;
  /** visible lines; the box is lines × lineHeight em tall */
  lines: number;
  /** unitless line height — must match the leading in `className` */
  lineHeight: number;
  /** typography for the text (font size, leading, color, alignment) */
  className?: string;
  /** shown right after the last word (e.g. a "still speaking" dot) */
  tail?: React.ReactNode;
  /** shown under the text, inside the scroll (e.g. "which one?" answers) */
  after?: React.ReactNode;
};

export default function ScrollText({ text, lines, lineHeight, className = '', tail, after }: Props) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const follow = React.useRef(true);
  const prevText = React.useRef('');
  const [fades, setFades] = React.useState({ top: false, bottom: false });

  const measureFades = React.useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
    setFades((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }));
  }, []);

  // a new reply (not the current one growing) → follow it again
  if (!text.startsWith(prevText.current)) follow.current = true;
  const grew = text.length > prevText.current.length && text.startsWith(prevText.current);
  prevText.current = text;

  // only when the text changes (never after every render — measuring sets state, which re-rendered forever)
  React.useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (follow.current) el.scrollTo({ top: el.scrollHeight, behavior: grew ? 'smooth' : 'auto' });
    measureFades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // the box or its words change size (font load, rotation, words finishing their animation)
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (follow.current) el.scrollTop = el.scrollHeight;
      measureFades();
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measureFades]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    measureFades();
  };

  const stops = [
    fades.top ? 'transparent 0, #000 0.9em' : '#000 0',
    fades.bottom ? '#000 calc(100% - 0.9em), transparent 100%' : '#000 100%',
  ];
  const mask = fades.top || fades.bottom ? `linear-gradient(to bottom, ${stops.join(', ')})` : undefined;

  return (
    <div
      ref={boxRef}
      onScroll={onScroll}
      className={`overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      style={{ height: `${lines * lineHeight}em`, maskImage: mask, WebkitMaskImage: mask }}
      aria-live="polite"
    >
      <div className="flex min-h-full flex-col justify-center">
        <p className="[overflow-wrap:anywhere]">
          <AnimatedWords text={text} />
          {tail}
        </p>
        {after}
      </div>
    </div>
  );
}
