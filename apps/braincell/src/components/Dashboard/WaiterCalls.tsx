import { BellAlertIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { toastSuccess } from '../Toaster';

const initialCalls = [
  { id: 'CALL-21', table: 'Table 2', reason: 'Need bill', time: '2m ago', status: 'Pending' },
  { id: 'CALL-22', table: 'Table 6', reason: 'Water refill', time: '8m ago', status: 'Pending' },
  { id: 'CALL-20', table: 'Table 4', reason: 'Order help', time: '15m ago', status: 'Resolved' },
];

type Call = typeof initialCalls[number];

export default function WaiterCalls({ interactive = false }: { interactive?: boolean }) {
  const [calls, setCalls] = useState<Call[]>(initialCalls);

  const resolveCall = (id: string) => {
    setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'Resolved' } : c)));
    toastSuccess(`Call ${id} resolved`);
  };

  return (
    <div className="rounded-lg border border-[#ececec] bg-white p-5 shadow-sm">
      <h3 className="mb-4 font-semibold text-[#2e2e30]">Waiter Calls</h3>
      <ul className="divide-y divide-[#f0f0f0]">
        {calls.map((call) => (
          <li key={call.id} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-50 ring-1 ring-[#ececec]">
                <BellAlertIcon
                  className={`h-5 w-5 ${
                    call.status === 'Pending' ? 'text-pink-500 animate-pulse' : 'text-slate-400'
                  }`}
                />
              </div>
              <div>
                <div className="font-medium text-[#2e2e30]">{call.table}</div>
                <div className="text-xs text-[#6b6b70]">{call.reason}</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span
                className={`text-xs px-2 py-1 rounded-md border ${
                  call.status === 'Pending'
                    ? 'bg-pink-50 text-pink-600 border-pink-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
              >
                {call.status}
              </span>
              {interactive && call.status === 'Pending' && (
                <button
                  onClick={() => resolveCall(call.id)}
                  className="text-xs rounded-md border border-[#cecece] px-2 py-1 hover:bg-[#f5f5f5] text-[#2e2e30]"
                >
                  Resolve
                </button>
              )}
              <span className="text-xs text-[#9ca3af]">{call.time}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}