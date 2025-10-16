import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/auth';
import { registerDevice } from '../api/access';

type Location = { id: string; name: string };

function detectClient() {
  const ua = navigator.userAgent || '';
  const platform = (navigator as any).userAgentData?.platform || navigator.platform || '';
  const os =
    /Windows/i.test(platform) ? 'Windows' :
    /Mac/i.test(platform) ? 'macOS' :
    /Linux/i.test(platform) ? 'Linux' :
    /Android/i.test(ua) ? 'Android' :
    /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : 'Unknown';

  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) && !/Chrome\//.test(ua) ? 'Safari' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /MSIE|Trident\//.test(ua) ? 'IE' : 'Unknown';

  return { os, browser };
}

export default function SelectLocation() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get('/api/v1/locations');
        const items: Location[] = res.data?.items || [];
        if (!mounted) return;
        setLocations(items);
        if (items.length === 1) setSelected(items[0].id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || 'Failed to load locations');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const canContinue = useMemo(() => !!selected && !saving, [selected, saving]);

  const onContinue = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const { os, browser } = detectClient();
      await registerDevice({
        locationId: selected,
        label: 'POS Device',
        os,
        browser,
      });

      navigate('/dashboard', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to register device');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#ececec] bg-white p-6 shadow">
        <h1 className="text-center text-[18px] font-semibold text-slate-900">
          Which location are you signing from?
        </h1>

        {loading ? (
          <div className="mt-6 text-center text-sm text-slate-700">Loading locations…</div>
        ) : (
          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">Location</label>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full rounded-md border border-[#e2e2e2] px-3 py-2 text-[13px] focus:outline-none"
              >
                <option value="">Select a location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {error && <div className="text-[12px] text-rose-600">{error}</div>}

            <button
              onClick={onContinue}
              disabled={!canContinue}
              className="w-full rounded-md bg-[#2e2e30] text-white py-2.5 text-[13px] font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Continue'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}