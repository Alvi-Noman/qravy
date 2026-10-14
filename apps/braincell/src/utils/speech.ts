// apps/braincell/src/utils/speech.ts — hear the AI waiter's voice in the dashboard (Settings → AI Waiter): the same
// Azure voices and speech token the storefront uses.
const API_BASE = (import.meta.env.VITE_API_URL as string) || '';

export const VOICES = { female: 'bn-BD-NabanitaNeural', male: 'bn-BD-PradeepNeural' } as const;

const esc = (s: string) => s.replace(/[<&>"']/g, ' ');

/** Speaks `text` in `voice` and resolves once it starts playing (abort to stop fetching). */
export async function speak(voice: string, text: string, signal?: AbortSignal): Promise<HTMLAudioElement> {
  const t = await fetch(`${API_BASE}/azure/speech-token`, { signal }).then((r) => r.json());
  if (!t?.token || !t?.region) throw new Error('speech unavailable');
  const r = await fetch(`https://${t.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${t.token}`,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
    },
    body: `<speak version="1.0" xml:lang="bn-BD"><voice name="${voice}">${esc(text)}</voice></speak>`,
  });
  if (!r.ok) throw new Error('speech failed');
  const audio = new Audio(URL.createObjectURL(await r.blob()));
  await audio.play();
  return audio;
}

/** What the voice will read for a "say it like" ("sholo" → "শোলো"). */
export async function spokenFor(sayAs: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(`${API_BASE}/api/v1/public/pronounce?text=${encodeURIComponent(sayAs)}`, { signal });
  return r.ok ? String((await r.json())?.spoken ?? '') : '';
}
