// apps/cortex/src/pages/Live.tsx — right now: guests on storefronts (last 5 minutes), open orders and table calls.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, Empty, ErrorBox, Loading, Stat, Td, Th, fmt } from '../components/ui';

type LiveData = {
  guestsNow: number;
  openOrders: number;
  openCalls: number;
  aiTurnsLast5Min: number;
  byRestaurant: Array<{ tenantId: string; restaurant: string; guests: number; dineIn: number }>;
};

export default function Live() {
  const q = useQuery({ queryKey: ['live'], queryFn: () => api<LiveData>('/live'), refetchInterval: 10_000 });
  const d = q.data;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold text-stone-900">Live</h1>
        <p className="text-[13px] text-stone-500">Updates every 10 seconds. Guests count when they did something in the last 5 minutes.</p>
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Guests on storefronts" value={fmt.n(d.guestsNow)} />
            <Stat label="AI turns (5 min)" value={fmt.n(d.aiTurnsLast5Min)} />
            <Stat label="Open orders" value={fmt.n(d.openOrders)} sub="placed → ready, last 12 hours" />
            <Stat label="Waiting table calls" value={fmt.n(d.openCalls)} tone={d.openCalls ? 'bad' : undefined} />
          </div>
          <Card title="Where guests are now">
            {d.byRestaurant.length ? (
              <table className="w-full">
                <thead className="border-b border-stone-100">
                  <tr>
                    <Th>Restaurant</Th>
                    <Th right>Guests</Th>
                    <Th right>At a table</Th>
                    <Th right>Online</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {d.byRestaurant.map((r) => (
                    <tr key={r.tenantId} className="hover:bg-stone-50">
                      <Td>
                        <Link to={`/restaurants/${r.tenantId}`} className="font-medium hover:underline">
                          {r.restaurant}
                        </Link>
                      </Td>
                      <Td right>{r.guests}</Td>
                      <Td right>{r.dineIn}</Td>
                      <Td right>{r.guests - r.dineIn}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No guests on any storefront right now.</Empty>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
