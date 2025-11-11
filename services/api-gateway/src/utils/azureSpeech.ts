// services/api-gateway/src/utils/azureSpeech.ts

const TEN_MIN = 10 * 60 * 1000;

let cachedToken: string | null = null;
let cachedAt = 0;

function env(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function getSpeechToken(): Promise<{ token: string; region: string }> {
  const region = env("AZURE_SPEECH_REGION").trim();
  const key = env("AZURE_SPEECH_KEY").trim();

  // reuse for ~9 minutes
  if (cachedToken && Date.now() - cachedAt < 9 * 60 * 1000) {
    return { token: cachedToken, region };
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

  return { token, region };
}
