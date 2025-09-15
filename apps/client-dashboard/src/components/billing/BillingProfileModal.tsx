import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal';
import { getBilling, updateBilling, type BillingProfile } from '../../api/billing';

export default function BillingProfileModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (p: BillingProfile) => void;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [initial, setInitial] = useState<BillingProfile | null>(null);
  const [saving, setSaving] = useState(false);

  // Match TopbarSearch border behavior
  const fieldCls =
    'rounded-md border border-[#dbdbdb] px-2 py-2 text-sm transition-colors focus:outline-none focus:border-[#111827]';

  useEffect(() => {
    let mounted = true;
    if (open) {
      (async () => {
        setLoading(true);
        const p = await getBilling();
        if (!mounted) return;
        setProfile(p);
        setInitial(p);
        setLoading(false);
      })();
    }
    return () => {
      mounted = false;
    };
  }, [open]);

  const dirty = useMemo(() => {
    if (!profile || !initial) return false;
    return JSON.stringify(profile) !== JSON.stringify(initial);
  }, [profile, initial]);

  const set = <K extends keyof BillingProfile>(k: K, v: BillingProfile[K]) =>
    profile && setProfile({ ...profile, [k]: v });

  const onSave = async () => {
    if (!profile) return;
    setSaving(true);
    const next = await updateBilling(profile);
    setSaving(false);
    setInitial(next);
    setProfile(next);
    onSaved(next);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Billing profile" size="2xl" initialFocusRef={firstRef}>
      {/* Fixed-height panel with scrollable body */}
      <div className="flex h-[70vh] max-h-[70vh] flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-slate-200 px-4 py-3">
          <div className="text-[14px] font-semibold text-slate-900">Billing profile</div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading || !profile ? (
            <div className="h-full animate-pulse rounded-xl border border-[#ececec] bg-white" />
          ) : (
            <div className="grid gap-4">
              {/* Details */}
              <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
                <div className="text-[13px] font-medium text-slate-900">Details</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">Company name</label>
                    <input
                      ref={firstRef}
                      className={fieldCls}
                      value={profile.companyName}
                      onChange={(e) => set('companyName', e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">Billing email</label>
                    <input
                      type="email"
                      className={fieldCls}
                      value={profile.billingEmail}
                      onChange={(e) => set('billingEmail', e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <label className="text-[12px] font-medium text-slate-700">CC recipients (comma separated)</label>
                    <input
                      className={fieldCls}
                      value={profile.extraEmails.join(', ')}
                      onChange={(e) =>
                        set(
                          'extraEmails',
                          e.target.value
                            .split(',')
                            .map((v) => v.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Address */}
              <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
                <div className="text-[13px] font-medium text-slate-900">Address</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5 sm:col-span-2">
                    <label className="text-[12px] font-medium text-slate-700">Line 1</label>
                    <input
                      className={fieldCls}
                      value={profile.address.line1}
                      onChange={(e) => set('address', { ...profile.address, line1: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <label className="text-[12px] font-medium text-slate-700">Line 2</label>
                    <input
                      className={fieldCls}
                      value={profile.address.line2 || ''}
                      onChange={(e) => set('address', { ...profile.address, line2: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">City</label>
                    <input
                      className={fieldCls}
                      value={profile.address.city}
                      onChange={(e) => set('address', { ...profile.address, city: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">State/Region</label>
                    <input
                      className={fieldCls}
                      value={profile.address.state}
                      onChange={(e) => set('address', { ...profile.address, state: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">Postal code</label>
                    <input
                      className={fieldCls}
                      value={profile.address.postalCode}
                      onChange={(e) => set('address', { ...profile.address, postalCode: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">Country</label>
                    <input
                      className={fieldCls}
                      value={profile.address.country}
                      onChange={(e) => set('address', { ...profile.address, country: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Tax & dunning */}
              <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
                <div className="text-[13px] font-medium text-slate-900">Tax & dunning</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">Tax ID</label>
                    <input
                      className={fieldCls}
                      value={profile.taxId || ''}
                      onChange={(e) => set('taxId', e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">Tax status</label>
                    <select
                      className={fieldCls}
                      value={profile.taxExempt || 'none'}
                      onChange={(e) => set('taxExempt', e.target.value as BillingProfile['taxExempt'])}
                    >
                      <option value="none">None</option>
                      <option value="exempt">Exempt</option>
                      <option value="reverse">Reverse charge</option>
                    </select>
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <label className="text-[12px] font-medium text-slate-700">Dunning days</label>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={profile.dunningEnabled}
                          onChange={(e) => set('dunningEnabled', e.target.checked)}
                        />
                        Enable reminders
                      </label>
                      <input
                        className={fieldCls + ' w-full'}
                        value={profile.dunningDays.join(', ')}
                        onChange={(e) =>
                          set(
                            'dunningDays',
                            e.target.value
                              .split(',')
                              .map((v) => parseInt(v.trim(), 10))
                              .filter((n) => Number.isFinite(n) && n >= 1)
                          )
                        }
                        placeholder="e.g. 3, 7, 14"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-200 px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-sm">
              Cancel
            </button>
            <button
              className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-50"
              onClick={onSave}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}