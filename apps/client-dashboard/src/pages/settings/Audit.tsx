export default function SettingsAudit(): JSX.Element {
  const audits = Array.from({ length: 10 }).map((_, i) => ({
    id: `evt_${i + 1}`,
    actor: i % 3 === 0 ? 'owner@demo.example' : i % 3 === 1 ? 'chef@demo.example' : 'admin@demo.example',
    action: i % 2 === 0 ? 'Updated setting' : 'Invited member',
    at: new Date(Date.now() - i * 3600_000).toISOString(),
    ip: i % 2 === 0 ? '192.168.1.25' : '2001:db8::2',
  }));

  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Recent activity</div>
      <ul className="mt-2 divide-y divide-slate-100">
        {audits.map((a) => (
          <li key={a.id} className="grid gap-2 py-2 sm:grid-cols-12">
            <div className="sm:col-span-3 text-[13px] text-slate-700">{new Date(a.at).toLocaleString()}</div>
            <div className="sm:col-span-4 text-[13px] text-slate-900">{a.actor}</div>
            <div className="sm:col-span-3 text-[13px] text-slate-800">{a.action}</div>
            <div className="sm:col-span-2 text-[13px] text-slate-600">{a.ip}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}