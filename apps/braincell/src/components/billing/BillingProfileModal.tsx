import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal';
import { useAuthContext } from '../../context/AuthContext';
import {
  getBillingProfile,
  updateBillingProfile,
  type BillingProfilePayload,
} from '../../api/tenant';

export default function BillingProfileModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (p: BillingProfilePayload) => void;
}) {
  const { token } = useAuthContext();
  const firstRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<BillingProfilePayload | null>(null);
  const [initial, setInitial] = useState<BillingProfilePayload | null>(null);
  const [saving, setSaving] = useState(false);

  // Local text state for CC field (so we can normalize on blur/enter)
  const [ccText, setCcText] = useState('');

  // Match TopbarSearch border behavior
  const fieldCls =
    'rounded-md border border-[#dbdbdb] px-2 py-2 text-sm transition-colors focus:outline-none focus:border-[#111827]';

  const emptyProfile: BillingProfilePayload = {
    companyName: '',
    billingEmail: '',
    extraEmails: [],
    address: {
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    },
    taxId: '',
    taxExempt: 'none',
    dunningEnabled: true,
    dunningDays: [3, 7, 14],
  };

  useEffect(() => {
    let mounted = true;
    if (open) {
      (async () => {
        setLoading(true);
        try {
          let p: BillingProfilePayload | null = null;
          if (token) {
            p = await getBillingProfile(token);
          }
          if (!mounted) return;
          const next = p ?? emptyProfile;
          setProfile(next);
          setInitial(next);
          // Initialize CC text from array
          setCcText((next.extraEmails ?? []).join(', '));
        } finally {
          if (mounted) setLoading(false);
        }
      })();
    }
    return () => {
      mounted = false;
    };
  }, [open, token]);

  const dirty = useMemo(() => {
    if (!profile || !initial) return false;
    return JSON.stringify(profile) !== JSON.stringify(initial);
  }, [profile, initial]);

  const set = <K extends keyof BillingProfilePayload>(k: K, v: BillingProfilePayload[K]) =>
    profile && setProfile({ ...profile, [k]: v });

  // Helpers for CC parsing/dedup
  const parseCc = (raw: string): string[] => {
    return raw
      .split(/[,;\n\s]+/) // comma, semicolon, newline, or whitespace
      .map((v) => v.trim())
      .filter(Boolean)
      .filter(uniqueCaseInsensitive);
  };
  function uniqueCaseInsensitive(v: string, i: number, a: string[]) {
    const lc = v.toLowerCase();
    return a.findIndex((x) => x.toLowerCase() === lc) === i;
  }

  const onSave = async () => {
    if (!profile || !token) return;
    setSaving(true);
    try {
      const sanitized: BillingProfilePayload = {
        ...profile,
        address: {
          ...profile.address,
          line2: (profile.address.line2 || undefined) as string | undefined,
        },
        // Always normalize CCs from the text box before save
        extraEmails: parseCc(ccText),
      };
      const next = await updateBillingProfile(sanitized, token);
      setInitial(next);
      setProfile(next);
      // Normalize the text box to a canonical comma+space list
      setCcText((next.extraEmails ?? []).join(', '));
      onSaved(next);
      onClose();
    } finally {
      setSaving(false);
    }
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
                      placeholder="e.g. billing@example.com, owner@example.com"
                      value={ccText}
                      onChange={(e) => {
                        const txt = e.target.value;
                        setCcText(txt);
                        set('extraEmails', parseCc(txt));
                      }}
                      onBlur={() => {
                        // Normalize on blur so separators look tidy
                        setCcText(parseCc(ccText).join(', '));
                      }}
                      onKeyDown={(e) => {
                        // Treat Enter as commit (text inputs don't accept newlines)
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setCcText(parseCc(ccText).join(', '));
                        }
                      }}
                      onPaste={(e) => {
                        // Allow pasting of newline/semicolon separated lists
                        const data = e.clipboardData.getData('text');
                        if (data && /[,;\n\s]/.test(data)) {
                          // Let it paste, then onChange will parse; no need to preventDefault
                          // Left here for clarity
                        }
                      }}
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

                  {/* Simple native dropdown for Tax status */}
                  <div className="grid gap-1.5">
                    <label className="text-[12px] font-medium text-slate-700">Tax status</label>
                    <select
                      className={fieldCls}
                      value={profile.taxExempt || 'none'}
                      onChange={(e) => set('taxExempt', e.target.value as BillingProfilePayload['taxExempt'])}
                    >
                      <option value="none">None</option>
                      <option value="exempt">Exempt</option>
                      <option value="reverse">Reverse charge</option>
                    </select>
                  </div>

                  {/* Dunning days — toggle and input on one line */}
                  <div className="grid gap-1.5 sm:col-span-2">
                    <label className="text-[12px] font-medium text-slate-700">Dunning days</label>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={!!profile.dunningEnabled}
                          onChange={(e) => set('dunningEnabled', e.target.checked)}
                        />
                        <span>Enable reminders</span>
                      </label>
                      <input
                        className={fieldCls + ' flex-1 min-w-[160px]'}
                        value={(profile.dunningDays ?? []).join(', ')}
                        onChange={(e) =>
                          set(
                            'dunningDays',
                            e.target.value
                              .split(/[,;\s]+/) // allow comma, semicolon, or space
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
              disabled={!dirty || saving || !token}
              title={!token ? 'You must be logged in to save' : undefined}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}