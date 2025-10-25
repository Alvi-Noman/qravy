import React, { useMemo, useState } from "react";

function blobToUrl(b: Blob) {
  return URL.createObjectURL(b);
}

export default function BanglaTTSLab(): JSX.Element {
  const [text, setText] = useState<string>("হ্যালো! আমি কেমন শোনাচ্ছি?");
  const [voice, setVoice] = useState<string>(
    "Sita's Bengali voice, warm and natural, clear studio recording, slightly slower pace, very clear audio."
  );
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const ttsUrl = useMemo(() => import.meta.env.VITE_TTS_URL as string, []);

  async function speak() {
    if (!text.trim()) return;
    setBusy(true);
    setAudioUrl(null);
    try {
      const res = await fetch(ttsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) {
        let msg = "TTS failed";
        try { msg = (await res.json()).error ?? msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      setAudioUrl(blobToUrl(blob));
    } catch (err) {
      alert((err as Error).message || "Could not synthesize speech.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Bangla TTS Lab</h1>

      <label className="block text-sm font-medium">Bangla Text</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="w-full rounded border p-2"
        placeholder="এখানে বাংলা লিখুন…"
      />

      <label className="block text-sm font-medium">Voice Description (optional)</label>
      <input
        value={voice}
        onChange={(e) => setVoice(e.target.value)}
        className="w-full rounded border p-2"
        placeholder="e.g., Sita's Bengali voice, warm and natural..."
      />

      <div className="flex items-center gap-3">
        <button
          onClick={speak}
          disabled={busy || !text.trim()}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {busy ? "Generating…" : "Speak"}
        </button>
        <span className="text-sm opacity-70">TTS server: {ttsUrl}</span>
      </div>

      {audioUrl && (
        <div className="pt-2">
          <audio src={audioUrl} controls autoPlay />
          <div className="text-xs opacity-70 mt-1">WAV generated locally</div>
        </div>
      )}
    </div>
  );
}
