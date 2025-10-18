import { useState } from 'react';

export default function SettingsIntegrations(): JSX.Element {
  const [stripeConnected, setStripeConnected] = useState(false);
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [gaMeasurementId, setGaMeasurementId] = useState('');

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const connectStripe = async () => {
    setStripeConnected(true);
    setDirty(true);
  };

  const testSlack = async () => {
    await new Promise((r) => setTimeout(r, 400));
  };

  const save = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    setDirty(false);
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-slate-900">Stripe</div>
          <button onClick={connectStripe} className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50">
            {stripeConnected ? 'Reconnect' : 'Connect'}
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={stripeConnected} onChange={(e) => (setStripeConnected(e.target.checked), setDirty(true))} /> Stripe connected
          </label>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Webhook secret</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={stripeWebhookSecret}
              onChange={(e) => (setStripeWebhookSecret(e.target.value), setDirty(true))}
              placeholder="whsec_****"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-slate-900">Slack</div>
          <button onClick={testSlack} className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50">
            Send test
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Incoming webhook URL</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={slackWebhookUrl}
              onChange={(e) => (setSlackWebhookUrl(e.target.value), setDirty(true))}
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Google Analytics</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Measurement ID</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={gaMeasurementId}
              onChange={(e) => (setGaMeasurementId(e.target.value), setDirty(true))}
              placeholder="G-XXXXXXXXXX"
            />
          </div>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-4 z-10 mx-auto w-full max-w-2xl rounded-xl border border-[#ececec] bg-white/95 p-3 shadow-md backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-800">{saving ? 'Saving…' : 'Unsaved changes'}</div>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm" onClick={() => setDirty(false)}>
                Discard
              </button>
              <button disabled={saving} onClick={save} className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}