// apps/tastebud/src/waiter/WaiterSheets.tsx
// The waiter's screens, shared by every page that has the waiter (AIWaiterHome, DigitalMenu …): the suggestions sheet,
// the tray (with the option picker and the waiter's offer), the dock (the orb + subtitles + answer pills) and the
// screen-edge glow while the mic is open. They read the shared session (useWaiterSession) — change them here, once.
import React from 'react';
import SuggestionsModal from '../components/ai-waiter/SuggestionsModal';
import TrayModal from '../components/ai-waiter/CartModal';
import AssistantDock from '../components/ai-waiter/AssistantDock';
import VoiceEdgeGlow from '../components/ai-waiter/VoiceEdgeGlow';
import { VOICE_STATUS, type WaiterSession } from './useWaiterSession';

/** The waiter's presence: the orb on a pink dock (hold it to talk), what it says as subtitles, the answer pills.
 *  While listening / thinking there's nothing new to subtitle — the status shows. */
export function WaiterDock({ w, originFromOrb = true }: { w: WaiterSession; originFromOrb?: boolean }) {
  const { orbMode, aiLive, aiFinal, aiAt, orbPressProps, orbBallRef, choices, sendTyped, lastReplyAt, isSilentPending, selectedLang } =
    w;
  const L = selectedLang === 'en' ? 1 : 0; // the status in the waiter's language ("ভাবছি…" / "Thinking…")
  // opened by a tap (the menu page, "AI suggestions", the tray from its button): compact, no text — an older reply
  // isn't shown here. Holding the orb keeps it compact; once the guest lets go it rises with "Thinking…" under the
  // orb, then the reply (and stays grown). Opened by the waiter mid-conversation (it is speaking / just answered):
  // full height at once.
  const [mountedAt] = React.useState(() => Date.now());
  const replying =
    ((orbMode === 'thinking' || orbMode === 'talking') && !isSilentPending()) || lastReplyAt > mountedAt;
  const [engaged, setEngaged] = React.useState(() => replying || Date.now() - lastReplyAt < 4000);
  React.useEffect(() => {
    if (replying) setEngaged(true);
  }, [replying]);
  // only what the waiter says in answer to the latest request: an older line (the welcome from the home screen, the
  // previous answer) is never shown while this reply's voice is still starting — "Thinking…" stays until its words do
  const said = aiLive || (aiAt >= lastReplyAt ? aiFinal : '');
  const busy = orbMode === 'listening' || orbMode === 'thinking';
  return (
    <AssistantDock
      mode={orbMode}
      status={
        orbMode === 'listening'
          ? VOICE_STATUS.hearing[L]
          : orbMode === 'thinking' || (engaged && !said && orbMode === 'talking')
          ? VOICE_STATUS.thinking[L]
          : ''
      }
      subtitle={busy ? undefined : said || undefined}
      orbProps={orbPressProps}
      originRef={originFromOrb ? orbBallRef : undefined}
      choices={engaged ? choices : []}
      onChoose={(say) => void sendTyped(say)}
      compact={!engaged}
    />
  );
}

/** The sheets the waiter opens (and their dock), the edge glow and the screen-reader status. */
export default function WaiterSheets({ w, dockEnabled = true }: { w: WaiterSession; dockEnabled?: boolean }) {
  const {
    showSuggestions, setShowSuggestions, setHighlightIds, suggestedItems, highlightIds, handleSuggestionsReply,
    showTray, setShowTray, setTrayPicks, setTrayAskTable, resolvedChannel, trayPicks, trayAskTable, lastMeta, mapUpsell,
    upsellItems, handleTrayReply, pickOptions, sendTyped, offerItemIds, listening, micLevel, session, voiceState,
  } = w;
  const assistantDock = dockEnabled ? <WaiterDock w={w} /> : undefined;
  return (
    <>
      <SuggestionsModal
        open={showSuggestions}
        onClose={() => {
          setShowSuggestions(false);
          setHighlightIds([]);
        }}
        items={suggestedItems}
        highlightIds={highlightIds}
        voiceBar={false /* the voice session talks here — its presence is the dock */}
        assistant={assistantDock}
        onIntent={handleSuggestionsReply}
      />
      <TrayModal
        open={showTray}
        channel={resolvedChannel}
        onClose={() => {
          setShowTray(false);
          setTrayPicks([]);
          setTrayAskTable(false);
          setHighlightIds([]);
        }}
        picks={trayPicks}
        askTable={trayAskTable}
        highlightIds={highlightIds}
        upsellItems={lastMeta?.upsell?.length ? mapUpsell(lastMeta.upsell as any[]) : upsellItems}
        voiceBar={false /* the voice session talks here — its presence is the dock */}
        assistant={assistantDock}
        onIntent={handleTrayReply}
        pickOptions={pickOptions}
        onPickAnswer={(say) => void sendTyped(say)}
        offerItemIds={offerItemIds}
      />

      {/* THE VOICE SESSION's presence. A sheet open: the orb shrinks onto the sheet's top edge — still listening /
          thinking / speaking (sheets have no mic of their own). While the mic is really open, the screen's edge glows. */}
      <VoiceEdgeGlow on={listening} level={micLevel} />
      <span className="sr-only" role="status" aria-live="polite">
        {session !== 'off' && !(showSuggestions || showTray) ? VOICE_STATUS[voiceState][1] : ''}
      </span>
    </>
  );
}
