// apps/tastebud/src/themes/ember/EmberChat.tsx
// 5.1 Type mode — the same conversation as voice, as messages: Pixie on the left with a mini orb, the guest on the
// right in white. A text that changed the order gets a dish card marked "Added". Suggestion chips sit above the box;
// the orb sits in the box as the way back to voice (the keyboard covers the bottom bar).
// The log is this tab's (sessionStorage), so it survives moving between Home and the Menu.
import { useEffect, useRef, useState } from 'react';
import { useCart, type CartItem } from '../../context/CartContext';
import type { WaiterSession } from '../../waiter/useWaiterSession';
import { money } from '../../utils/ui-lang';
import { EM, I, ORB_GRADIENT, tx, type Lang } from './ui';

export type ChatEntry = { who: 'guest' | 'ai'; text: string; at: number; added?: Pick<CartItem, 'name' | 'qty' | 'imageUrl'>[] };

const logKey = (sub: string) => `qravy:ember:chat:${sub}`;
const KEEP_MS = 3 * 60 * 60 * 1000;

function readLog(sub: string): ChatEntry[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(logKey(sub)) || '[]') as ChatEntry[];
    return list.filter((e) => Date.now() - e.at < KEEP_MS).slice(-60);
  } catch {
    return [];
  }
}

/** The conversation so far: what the guest typed / tapped, and every reply the waiter finished. */
export function useChatLog(w: WaiterSession, sub: string) {
  const [log, setLog] = useState<ChatEntry[]>(() => readLog(sub));
  const { lastChange } = useCart();
  const save = (next: ChatEntry[]) => {
    setLog(next);
    try {
      sessionStorage.setItem(logKey(sub), JSON.stringify(next.slice(-60)));
    } catch {
      /* storage blocked */
    }
  };
  const logRef = useRef(log);
  logRef.current = log;
  // a finished reply → Pixie's bubble (with what that turn added to the order)
  const seenAt = useRef(w.aiAt);
  useEffect(() => {
    const text = (w.aiFinal || '').trim();
    if (!text || w.aiLive || w.aiAt === seenAt.current) return;
    seenAt.current = w.aiAt;
    const last = logRef.current[logRef.current.length - 1];
    if (last?.who === 'ai' && last.text === text) return;
    const added =
      lastChange && lastChange.at >= (last?.at ?? 0) - 1000 && lastChange.added.length
        ? lastChange.added.map((a) => ({ name: a.name, qty: a.qty, imageUrl: a.imageUrl }))
        : undefined;
    save([...logRef.current, { who: 'ai', text, at: Date.now(), ...(added ? { added } : {}) }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.aiAt, w.aiFinal, w.aiLive]);
  /** the guest says something by text (a chip, or the box): logged, then sent like speech */
  const say = (text: string, opts?: { silent?: boolean }) => {
    const t = text.trim();
    if (!t) return;
    save([...logRef.current, { who: 'guest', text: t, at: Date.now() }]);
    // its answer is shown in the chat (and spoken only in a voice conversation) — a typed message never goes unanswered
    void w.sendTyped(t, { showText: true, ...opts });
  };
  return { log, say };
}

function MiniOrb({ size = 26 }: { size?: number }) {
  return <span aria-hidden="true" className="shrink-0 rounded-full" style={{ width: size, height: size, background: ORB_GRADIENT() }} />;
}

export default function EmberChat({
  open,
  onClose,
  w,
  lang,
  waiterName,
  log,
  say,
  chips,
  right,
}: {
  open: boolean;
  onClose: () => void;
  w: WaiterSession;
  lang: Lang;
  waiterName: string;
  log: ChatEntry[];
  say: (t: string) => void;
  chips: { label: string; onClick: () => void }[];
  /** EN + Call waiter (dine-in) */
  right?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const thinking = w.orbMode === 'thinking';
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [log.length, thinking, w.aiLive, open]);
  if (!open) return null;
  const send = () => {
    if (!text.trim()) return;
    say(text);
    setText('');
  };
  const live = (w.aiLive || '').trim();
  return (
    <div className="em-fade absolute inset-0 z-[120] flex flex-col" style={{ background: EM.bg }}>
      {/* ‹ Pixie · AI waiter   …   EN · Call waiter */}
      <div className="flex shrink-0 items-center px-2 pr-4 pt-[calc(env(safe-area-inset-top,0px)+14px)]">
        <button type="button" aria-label={tx(lang, 'হোমে ফিরুন', 'Back to home')} onClick={onClose} className="flex h-11 items-center gap-1.5 pr-2.5">
          {I.back()}
          <MiniOrb size={30} />
          <span className="flex flex-col items-start gap-px">
            <span className="text-[17px] font-semibold leading-tight">{waiterName}</span>
            <span className="text-[12px]" style={{ color: EM.text3 }}>{tx(lang, 'AI ওয়েটার', 'AI waiter')}</span>
          </span>
        </button>
        <span className="flex-1" />
        <div className="flex items-center gap-2">{right}</div>
      </div>

      <div ref={listRef} className="em-noscroll min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end gap-3 px-4 pb-3 pt-2">
          {log.length === 0 && !live && (
            <p className="py-10 text-center text-[14px]" style={{ color: EM.muted }}>
              {tx(lang, `${waiterName}-কে যেকোনো কিছু লিখুন — মেনু, পরামর্শ, বা অর্ডার।`, `Ask ${waiterName} anything — the menu, a suggestion, or your order.`)}
            </p>
          )}
          {log.map((m, i) =>
            m.who === 'guest' ? (
              <div key={i} className="max-w-[260px] self-end rounded-[18px_18px_6px_18px] px-3.5 py-2.5 text-[15px] leading-[1.4]" style={{ background: EM.text, color: EM.bg }}>
                {m.text}
              </div>
            ) : (
              <div key={i} className="flex max-w-[310px] items-end gap-2">
                <MiniOrb />
                <div className="flex flex-col gap-2 rounded-[18px_18px_18px_6px] px-3.5 py-2.5 text-[15px] leading-[1.4]" style={{ background: EM.surface2 }}>
                  {m.text}
                  {m.added?.length ? (
                    <div className="flex items-center gap-2.5 rounded-xl p-2" style={{ background: EM.surface }}>
                      {m.added[0].imageUrl ? (
                        <img src={m.added[0].imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-[10px] object-cover" />
                      ) : (
                        <div className="h-11 w-11 shrink-0 rounded-[10px]" style={{ background: '#2A1F12' }} />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[14px] font-semibold">{m.added[0].name}</span>
                        {m.added.length > 1 && (
                          <span className="truncate text-[13px]" style={{ color: EM.text3 }}>
                            {m.added
                              .slice(1)
                              .map((a) => `+ ${a.qty > 1 ? `${a.qty} ` : ''}${a.name}`)
                              .join(', ')}
                          </span>
                        )}
                      </div>
                      <span className="flex h-7 shrink-0 items-center rounded-full px-2.5 text-[12px] font-bold" style={{ background: EM.amber, color: EM.bg }}>
                        {tx(lang, 'যোগ হয়েছে', 'Added')}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            ),
          )}
          {(live || thinking) && (
            <div className="flex max-w-[310px] items-end gap-2">
              <MiniOrb />
              <div className="rounded-[18px_18px_18px_6px] px-3.5 py-2.5 text-[15px] leading-[1.4]" style={{ background: EM.surface2 }}>
                {live || (
                  <span className="em-dots inline-flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                  </span>
                )}
              </div>
            </div>
          )}
          {/* "which one?" — the waiter's own answers */}
          {w.choices.length > 0 && !thinking && (
            <div className="flex flex-wrap gap-2 pl-[34px]">
              {w.choices.map((c) => (
                <button
                  key={c.say}
                  type="button"
                  onClick={() => say(c.say)}
                  className="h-9 rounded-full px-3.5 text-[14px]"
                  style={{ border: `1px solid ${EM.chipLine}`, background: EM.chip }}
                >
                  {c.label}
                  {typeof c.price === 'number' && <span style={{ color: EM.text3 }}> {money(c.price)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ✦ suggestions above the box */}
      {chips.length > 0 && (
        <div className="em-noscroll flex shrink-0 gap-2 overflow-x-auto px-4 pb-2">
          <span aria-hidden="true" className="flex h-9 shrink-0 items-center" style={{ color: EM.amber }}>
            {I.sparkle({ size: 16 })}
          </span>
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={c.onClick}
              className="h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[14px]"
              style={{ border: `1px solid ${EM.chipLine}`, background: EM.chip, color: EM.text }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* the box, with the orb as the switch back to voice */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
        <form
          className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full pl-4 pr-1.5"
          style={{ border: '1px solid #3A3A3F', background: EM.surface }}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            ref={inputRef}
            aria-label={tx(lang, 'ওয়েটারকে লিখুন', 'Message your waiter')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tx(lang, 'ওয়েটারকে লিখুন…', 'Message your waiter…')}
            className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#6E6E73]"
            style={{ color: EM.text }}
            enterKeyHint="send"
          />
          <button type="submit" aria-label={tx(lang, 'পাঠান', 'Send')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: EM.text, color: EM.bg }}>
            {I.arrowUp()}
          </button>
        </form>
        <button
          type="button"
          aria-label={tx(lang, 'কথা বলুন', 'Switch to voice')}
          onClick={() => {
            onClose();
            void w.startListening();
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={{ background: ORB_GRADIENT(), boxShadow: '0 0 20px rgba(245,165,36,0.35)' }}
        >
          {I.mic({ size: 22, stroke: '#3A1A00', sw: 2.2 })}
        </button>
      </div>
    </div>
  );
}
