// services/auth-service/scripts/voice-timing-report.ts
// Where a spoken AI-waiter turn's time goes, from the moment the guest stops talking to the moment they hear the
// first word of the reply — the 'voice_timing' guest events (apps/tastebud/src/waiter/useWaiterSession.tsx, the
// server's part from ai-waiter-service server.py). Read-only: it prints the median and the slow end (90th
// percentile) of every step, for all turns and split by phone type and by whether the AI was asked at all.
//
//   MONGODB_URI=… npx tsx scripts/voice-timing-report.ts            (last 7 days, every restaurant)
//   MONGODB_URI=… npx tsx scripts/voice-timing-report.ts 2 burger-house   (last 2 days, one restaurant)
import { client } from '../src/db.js';

// the steps in order — together they make up totalMs (serverMs already includes stt, prep, brain, post)
const STEPS: Array<[string, string]> = [
  ['vadMs', 'silence wait (hands-free)'],
  ['sttMs', 'speech → text'],
  ['prepMs', 'menu & facts'],
  ['brainMs', 'brain (incl. AI)'],
  ['modelMs', '  of which the AI'],
  ['postMs', 'after the brain'],
  ['serverMs', 'server total'],
  ['replyMs', 'quiet → reply in phone'],
  ['voiceMs', 'reply → first sound'],
  ['totalMs', 'quiet → first sound'],
];

type Row = Record<string, number>;

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p + 0.5))];
}

function table(title: string, rows: Row[]) {
  console.log(`\n${title} — ${rows.length} turns`);
  if (!rows.length) return;
  console.log('  step                       median     p90');
  for (const [key, label] of STEPS) {
    const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
    if (!vals.length) continue;
    const med = pct(vals, 0.5);
    const p90 = pct(vals, 0.9);
    console.log(`  ${label.padEnd(26)} ${String(Math.round(med)).padStart(6)}ms ${String(Math.round(p90)).padStart(6)}ms`);
  }
  const share = (f: (r: Row) => boolean) => `${Math.round((100 * rows.filter(f).length) / rows.length)}%`;
  console.log(
    `  AI asked twice (self-check): ${share((r) => (r.modelCalls ?? 0) >= 2)} · ` +
      `speech-to-text retried: ${share((r) => (r.sttCalls ?? 0) >= 2)} · ` +
      `hands-free (silence wait): ${share((r) => (r.vadMs ?? 0) > 0)}`,
  );
}

async function main() {
  const days = Number(process.argv[2]) || 7;
  const sub = process.argv[3]?.toLowerCase();
  await client.connect();
  const docs = await client
    .db('authDB')
    .collection('guestEvents')
    .find({ type: 'voice_timing', at: { $gte: new Date(Date.now() - days * 86_400_000) }, ...(sub ? { sub } : {}) })
    .project({ data: 1, device: 1 })
    .toArray();
  const rows = docs.map((d) => ({ ...(d.data ?? {}), mobile: d.device === 'desktop' ? 0 : 1 }) as Row);

  console.log(`Voice turns, last ${days} day(s)${sub ? ` at ${sub}` : ''}`);
  table('All', rows);
  table('iPhone', rows.filter((r) => r.ios === 1));
  table('Other phones / tablets', rows.filter((r) => r.ios !== 1 && r.mobile === 1));
  table('Desktop', rows.filter((r) => r.mobile === 0));
  table('Answered by the AI', rows.filter((r) => (r.modelCalls ?? 0) > 0));
  table('Answered by the code (no AI)', rows.filter((r) => (r.modelCalls ?? 0) === 0));
  await client.close();
}

main().catch(async (e) => {
  console.error(e);
  await client.close();
  process.exit(1);
});
