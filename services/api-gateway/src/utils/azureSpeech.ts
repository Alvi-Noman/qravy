// services/api-gateway/src/utils/azureSpeech.ts

// Azure speech tokens live 10 minutes. We reuse one for at most 5, and tell the client when it really expires —
// before, a token reused here for up to 9 min (and cached by the browser for 8 more) reached the client already
// dead: every reply then failed silently until a page reload.
const TOKEN_LIFE_MS = 10 * 60 * 1000;
const REUSE_MS = 5 * 60 * 1000;

let cachedToken: string | null = null;
let cachedAt = 0;

function env(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function getSpeechToken(
  opts: { fresh?: boolean } = {},
): Promise<{ token: string; region: string; expiresAt: number }> {
  const region = env("AZURE_SPEECH_REGION").trim();
  const key = env("AZURE_SPEECH_KEY").trim();

  if (!opts.fresh && cachedToken && Date.now() - cachedAt < REUSE_MS) {
    return { token: cachedToken, region, expiresAt: cachedAt + TOKEN_LIFE_MS };
  }

  const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Azure token issue failed: ${res.status} ${body}`);
  }

  const token = await res.text();
  cachedToken = token;
  cachedAt = Date.now();

  return { token, region, expiresAt: cachedAt + TOKEN_LIFE_MS };
}
