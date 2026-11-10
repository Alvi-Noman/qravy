// apps/tastebud/src/themes/ember/Chrome.tsx
// What every Ember page has around its content: the top bar's right side (dine-in: EN · Call waiter; online: the
// Delivery / Pickup chip · EN), the call-waiter sheet and its "on the way" card, the mode sheet, and Type mode.
import { useState } from 'react';
import type { WaiterSession } from '../../waiter/useWaiterSession';
import { useFulfillment } from '../../utils/order-mode';
import EmberChat, { useChatLog } from './EmberChat';
import ModeSheet from './ModeSheet';
import UndoBar from './UndoBar';
import { ownMessage, type GuestMessages } from '../../utils/guestMessages';
import { CallSheet, CallStatusCard, CallWaiterPill, LangButton, ModeChip, useServiceCalls, type Lang } from './ui';
import type { useStoreRoute } from './store';

export function useEmberChrome({ w, route, chatChips = [] }: { w: WaiterSession; route: ReturnType<typeof useStoreRoute>; chatChips?: string[] }) {
  const lang: Lang = w.selectedLang === 'en' ? 'en' : 'bn';
  const { sub, branch, online, table, waiterName } = route;
  const calls = useServiceCalls(online ? null : sub, online ? null : table, branch);
  const [callOpen, setCallOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [fulfillment, setFulfillment] = useFulfillment(sub);
  const { log, say } = useChatLog(w, sub);
  // "Waiter called" until a staff member taps it, then "On the way" (the original theme's labels)
  const callState: 'none' | 'called' | 'coming' = !calls.latest
    ? 'none'
    : Object.values(calls.active).some((a) => a?.status === 'acknowledged')
    ? 'coming'
    : 'called';
  // the restaurant's own call confirmation (Settings → Guest messages), else the original wording
  const callMessage =
    ownMessage((route.info as { guestMessages?: GuestMessages } | null)?.guestMessages, 'waiterCall', lang, { table, restaurant: route.info?.name, waiter: waiterName }) ??
    (lang === 'en' ? "We've let the staff know — someone will be at your table shortly." : 'স্টাফকে জানানো হয়েছে — কেউ এখনই আপনার টেবিলে আসছেন।');

  const lang$ = <LangButton lang={lang} onChange={(l) => w.setSelectedLang(l)} />;
  const right = online ? lang$ : (
    <>
      {lang$}
      {table && <CallWaiterPill state={callState} lang={lang} onClick={() => setCallOpen(true)} />}
    </>
  );
  // online: the mode chip sits on the left of Home's bar, before EN on the menu
  const modeChip = online ? <ModeChip mode={fulfillment} lang={lang} onClick={() => setModeOpen(true)} /> : null;
  const statusCard =
    calls.latest && table && calls.hidden !== calls.latest.token ? (
      <CallStatusCard message={callMessage} status={calls.latest.status} lang={lang} onClose={() => calls.hide(calls.latest!.token)} />
    ) : null;

  const overlays = (
    <>
      <UndoBar lang={lang} replyAt={w.aiAt} />
      <CallSheet open={callOpen} onClose={() => setCallOpen(false)} lang={lang} onCall={(k, note) => calls.call(k, note)} />
      {online && (
        <ModeSheet open={modeOpen} onClose={() => setModeOpen(false)} mode={fulfillment} onMode={setFulfillment} sub={sub} branch={branch} lang={lang} />
      )}
      <EmberChat
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        w={w}
        lang={lang}
        waiterName={waiterName}
        log={log}
        say={say}
        right={right}
        chips={chatChips.map((c) => ({ label: c, onClick: () => say(c) }))}
      />
    </>
  );
  return { lang, right, modeChip, statusCard, overlays, say, log, openChat: () => setChatOpen(true), openModes: () => setModeOpen(true), fulfillment, setFulfillment };
}
