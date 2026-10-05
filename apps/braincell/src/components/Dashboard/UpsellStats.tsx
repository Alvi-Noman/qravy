// The AI waiter's offers this week (ai-waiter-service /upsell/stats): how often guests say yes, the extra revenue,
// order value with vs without an accepted offer, how often a conversation ended right on an offer — and the A/B arms
// (wording: a reason vs just the price · timing: right after food is added vs only at the end).
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../context/AuthContext';
import { waiterFetch } from '../../api/waiter';

type Summary = {
  offers: number;
  accepted: number;
  declined: number;
  ignored: number;
  pending: number;
  takeRate: number | null;
  revenue: number;
  sessions: number;
  sessionsWithOffer: number;
  aovWithAccepted: number | null;
  aovWithout: number | null;
  aovLift: number | null;
  endedAfterOfferRate: number | null;
};
type Stats = Summary & {
  days: number;
  byType: Record<string, { offers: number; accepted: number; takeRate: number | null; revenue: number }>;
  byArm: Record<string, Summary>;
};

const BDT = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 });
const taka = (n: number | null | undefined) => (typeof n === 'number' ? `৳${BDT.format(n)}` : '—');
const pct = (n: number | null | undefined) => (typeof n === 'number' ? `${Math.round(n * 100)}%` : '—');

const TYPE_LABEL: Record<string, string> = {
  combo: 'Combo swap',
  meal_addon: 'Make it a meal',
  more_food: 'More for the group',
  rice: 'Rice with a curry',
  main: 'A main after starters',
  side: 'A side',
  drink: 'A drink',
  addon: 'Add-on (dip, extra)',
  dessert: 'Dessert at the end',
};

export default function UpsellStats({ tenantSubdomain, days = 7 }: { tenantSubdomain?: string; days?: number }) {
  const { getToken, refreshToken } = useAuthContext();
  const q = useQuery<Stats>({
    queryKey: ['upsell-stats', tenantSubdomain, days],
    enabled: !!tenantSubdomain,
    refetchInterval: 60_000,
    queryFn: async () => {
      // the restaurant's revenue: the staff login is checked by the waiter service
      const res = await waiterFetch(
        `/upsell/stats?tenant=${encodeURIComponent(tenantSubdomain as string)}&days=${days}`,
        {},
        { getToken, refreshToken },
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'stats unavailable');
      return data.stats as Stats;
    },
  });

  const s = q.data;
  return (
    <div className="rounded-lg border border-[#ececec] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-[#2e2e30]">AI waiter upsell · last {days} days</h3>
        {s && (
          <span className="text-xs text-[#6b6b70]">
            {s.offers} offers in {s.sessionsWithOffer} of {s.sessions} conversations
          </span>
        )}
      </div>

      {q.isLoading && <div className="h-24 animate-pulse rounded-md bg-slate-100" />}
      {q.isError && <p className="text-sm text-[#6b6b70]">Upsell numbers aren't available right now.</p>}
      {s && s.offers === 0 && (
        <p className="text-sm text-[#6b6b70]">No offers yet — they appear here as guests order through the AI waiter.</p>
      )}

      {s && s.offers > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Extra revenue" value={taka(s.revenue)} accent="text-emerald-600" />
            <Stat label="Guests said yes" value={pct(s.takeRate)} hint={`${s.accepted} yes · ${s.declined} no · ${s.ignored} ignored`} />
            <Stat
              label="Order value lift"
              value={s.aovLift === null ? '—' : `${s.aovLift >= 0 ? '+' : ''}${taka(s.aovLift)}`}
              hint={`${taka(s.aovWithAccepted)} with a yes vs ${taka(s.aovWithout)} without`}
            />
            <Stat
              label="Ended on an offer"
              value={pct(s.endedAfterOfferRate)}
              hint="conversations that stopped right after one"
              accent={(s.endedAfterOfferRate ?? 0) > 0.2 ? 'text-amber-600' : undefined}
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b6b70]">By offer</h4>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(s.byType)
                    .sort((a, b) => b[1].revenue - a[1].revenue)
                    .map(([type, t]) => (
                      <tr key={type} className="border-t border-[#f2f2f2]">
                        <td className="py-1.5 text-[#2e2e30]">{TYPE_LABEL[type] ?? type}</td>
                        <td className="py-1.5 text-right text-[#6b6b70]">{t.offers}×</td>
                        <td className="py-1.5 text-right text-[#6b6b70]">{pct(t.takeRate)}</td>
                        <td className="py-1.5 text-right font-medium text-[#2e2e30]">{taka(t.revenue)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b6b70]">
                A/B test · wording · timing
              </h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[#6b6b70]">
                    <th className="pb-1 text-left font-normal">Arm</th>
                    <th className="pb-1 text-right font-normal">Yes</th>
                    <th className="pb-1 text-right font-normal">Revenue</th>
                    <th className="pb-1 text-right font-normal">Avg order</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(s.byArm).map(([arm, a]) => (
                    <tr key={arm} className="border-t border-[#f2f2f2]">
                      <td className="py-1.5 text-[#2e2e30]">{arm}</td>
                      <td className="py-1.5 text-right text-[#6b6b70]">{pct(a.takeRate)}</td>
                      <td className="py-1.5 text-right text-[#6b6b70]">{taka(a.revenue)}</td>
                      <td className="py-1.5 text-right font-medium text-[#2e2e30]">
                        {taka(avgOrder(a))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-[#9a9aa0]">
                Each conversation gets one arm at random. Compare once each arm has a few dozen conversations.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The arm's average order: with-a-yes and without, weighted by how many conversations each had. */
function avgOrder(a: Summary): number | null {
  const vals = [a.aovWithAccepted, a.aovWithout].filter((v): v is number => typeof v === 'number');
  if (!vals.length) return null;
  if (vals.length === 1) return vals[0];
  const yes = a.accepted;
  const rest = Math.max(0, a.sessions - yes);
  return yes + rest ? ((a.aovWithAccepted as number) * yes + (a.aovWithout as number) * rest) / (yes + rest) : null;
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3 ring-1 ring-[#ececec]">
      <div className="text-xs text-[#6b6b70]">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ?? 'text-[#2e2e30]'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[#9a9aa0]">{hint}</div>}
    </div>
  );
}
