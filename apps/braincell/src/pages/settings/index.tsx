import { useEffect, useState } from 'react';
import { useTenant } from '../../hooks/useTenant';
import { useAuthContext } from '../../context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { updateTenant } from '../../api/tenant';
import { toastSuccess, toastError } from '../../components/Toaster';
import { BuildingOfficeIcon, MapPinIcon, ChevronRightIcon, EnvelopeIcon, PhoneIcon, UserIcon } from '@heroicons/react/24/outline';
import Modal from '../../components/Modal';

// Country Flag Emoji Helper
const getFlagEmoji = (countryName: string) => {
  const c = countryName.toLowerCase();
  if (c.includes('bangladesh') || c === 'bd') return '🇧🇩';
  if (c.includes('united states') || c === 'us' || c === 'usa') return '🇺🇸';
  if (c.includes('united kingdom') || c === 'uk' || c === 'gb') return '🇬🇧';
  if (c.includes('india') || c === 'in') return '🇮🇳';
  if (c.includes('afghanistan') || c === 'af') return '🇦🇫';
  if (c.includes('pakistan') || c === 'pk') return '🇵🇰';
  return '🌐';
};

// Dynamically sync and display correct country suffix in the address
const getDisplayAddress = (addrStr: string, activeCountry: string) => {
  if (!addrStr) return '';
  const parts = addrStr.split(',').map((p) => p.trim());
  if (parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    const commonCountries = ['bangladesh', 'afghanistan', 'united states', 'united kingdom', 'india', 'pakistan', 'canada'];
    if (commonCountries.includes(lastPart.toLowerCase()) && lastPart.toLowerCase() !== activeCountry.toLowerCase()) {
      parts[parts.length - 1] = activeCountry;
      return parts.join(', ');
    }
  }
  return addrStr;
};

export default function SettingsOverview(): JSX.Element {
  const { token, user } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: tenant, isLoading } = useTenant();

  // Modal open states
  const [editBusinessOpen, setEditBusinessOpen] = useState(false);
  const [editRestaurantContactOpen, setEditRestaurantContactOpen] = useState(false);
  const [editOwnerOpen, setEditOwnerOpen] = useState(false);
  const [editAddressOpen, setEditAddressOpen] = useState(false);

  // Local state for non-modal elements (like timezone)
  const [timezone, setTimezone] = useState('Asia/Dhaka');
  const [dirty, setDirty] = useState(false);
  const [savingTimezone, setSavingTimezone] = useState(false);

  useEffect(() => {
    if (tenant) {
      // Future-proofing timezone sync if added to backend
    }
  }, [tenant]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2e2e30] border-t-transparent" />
      </div>
    );
  }

  const storeName = tenant?.name || 'My Restaurant';
  const country = tenant?.restaurantInfo?.country || 'Bangladesh';
  const address = tenant?.restaurantInfo?.address || 'House No. 101/4, Crescent Road, Kathalbagan, 1205, Bangladesh';
  const restaurantEmail = tenant?.restaurantInfo?.email || user?.email || 'No email address';
  const restaurantPhone = tenant?.restaurantInfo?.phone || tenant?.ownerInfo?.phone || 'No phone number';

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['tenant', token] });
  };

  return (
    <div className="grid gap-4 pb-6">
      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">General</h2>
      </div>

      {/* 1. Restaurant Details */}
      <div className="rounded-xl border border-[#ececec] bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Restaurant details</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Restaurant entity used for financial products, markets, apps, and taxes in this restaurant
          </p>
        </div>
        
        <div 
          onClick={() => setEditBusinessOpen(true)}
          className="flex items-center justify-between rounded-xl border border-[#f0f0f0] bg-white p-4 hover:border-slate-300/80 hover:bg-slate-50/30 cursor-pointer transition-all"
        >
          <div className="flex items-center gap-4">
            <span className="text-3xl leading-none" role="img" aria-label={country}>
              {getFlagEmoji(country)}
            </span>
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-slate-800">{storeName}</span>
              <span className="text-[12px] text-slate-500 mt-0.5">{country}</span>
            </div>
          </div>
          <button className="text-slate-400 hover:text-slate-600">
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* 2. Restaurant Contact Details */}
      <div className="rounded-xl border border-[#ececec] bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Restaurant contact details</h2>
        </div>

        <div className="rounded-xl border border-[#f0f0f0] bg-white divide-y divide-[#f0f0f0] overflow-hidden">
          {/* Card item 1: Restaurant contact email & phone */}
          <div 
            onClick={() => setEditRestaurantContactOpen(true)}
            className="flex items-center justify-between p-4 hover:bg-slate-50/50 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="h-9 w-9 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500">
                <EnvelopeIcon className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[12px] text-slate-500">Contact email & phone</span>
                <span className="text-[13px] font-semibold text-slate-800 mt-0.5">
                  {restaurantEmail} · {restaurantPhone}
                </span>
              </div>
            </div>
            <button className="text-slate-400 hover:text-slate-600">
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Card item 2: Address */}
          <div 
            onClick={() => setEditAddressOpen(true)}
            className="flex items-center justify-between p-4 hover:bg-slate-50/50 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="h-9 w-9 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500">
                <MapPinIcon className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[12px] text-slate-500">Restaurant address</span>
                <span className="text-[13px] font-semibold text-slate-800 mt-0.5 leading-snug">
                  {getDisplayAddress(address, country)}
                </span>
              </div>
            </div>
            <button className="text-slate-400 hover:text-slate-600">
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Owner Details */}
      <div className="rounded-xl border border-[#ececec] bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Owner details</h2>
        </div>

        <div className="rounded-xl border border-[#f0f0f0] bg-white overflow-hidden">
          <div 
            onClick={() => setEditOwnerOpen(true)}
            className="flex items-center justify-between p-4 hover:bg-slate-50/50 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="h-9 w-9 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500">
                <UserIcon className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-semibold text-slate-800">
                  {tenant?.ownerInfo?.fullName || 'No owner name'}
                </span>
                <span className="text-[12px] text-slate-500 mt-0.5">
                  {tenant?.ownerInfo?.phone || 'No phone number'}
                </span>
              </div>
            </div>
            <button className="text-slate-400 hover:text-slate-600">
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Restaurant Defaults */}
      <div className="rounded-xl border border-[#ececec] bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Restaurant defaults</h2>
        </div>

        <div className="space-y-4">
          {/* Currency Display */}
          <div className="flex items-center justify-between rounded-xl border border-[#f0f0f0] bg-white p-4">
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-slate-800">Currency display</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-700">
                {country.toLowerCase().includes('bangladesh') ? 'Bangladeshi Taka (BDT ৳)' : 'US Dollar (USD $)'}
              </span>
            </div>
          </div>

          {/* Time Zone */}
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Time zone</label>
            <select
              className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none"
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                setDirty(true);
              }}
            >
              <option value="Asia/Dhaka">(GMT+06:00) Astana, Dhaka</option>
              <option value="Asia/Kolkata">(GMT+05:30) Chennai, Kolkata, Mumbai, New Delhi</option>
              <option value="UTC">(GMT+00:00) Coordinated Universal Time</option>
              <option value="America/New_York">(GMT-05:00) Eastern Time (US & Canada)</option>
            </select>
            <span className="text-[11px] text-slate-400 mt-0.5">Sets the time for when orders and analytics are recorded</span>
          </div>
        </div>

        {/* Account settings footer note */}
        <div className="border-t border-[#f0f0f0] pt-4 text-[12px] text-slate-500">
          To change your user level time zone and language visit your{' '}
          <span className="text-slate-700 underline cursor-pointer hover:text-slate-900">account settings</span>
        </div>
      </div>

      {/* Floating Save/Discard Action Bar (Only for local page modifications like Timezone if needed) */}
      {dirty && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-xl px-4">
          <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur flex items-center justify-between">
            <div className="text-xs font-medium text-slate-800">
              {savingTimezone ? 'Saving changes…' : 'Unsaved changes'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                onClick={() => {
                  setTimezone('Asia/Dhaka');
                  setDirty(false);
                }}
              >
                Discard
              </button>
              <button
                type="button"
                disabled={savingTimezone}
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition"
                onClick={async () => {
                  setSavingTimezone(true);
                  // Simulating save for local-only settings
                  setTimeout(() => {
                    setSavingTimezone(false);
                    setDirty(false);
                    toastSuccess('General defaults updated');
                  }, 500);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <EditBusinessDetailsModal
        open={editBusinessOpen}
        onClose={() => setEditBusinessOpen(false)}
        tenant={tenant}
        token={token}
        onSaved={handleSaved}
      />

      <EditRestaurantContactModal
        open={editRestaurantContactOpen}
        onClose={() => setEditRestaurantContactOpen(false)}
        tenant={tenant}
        token={token}
        onSaved={handleSaved}
      />

      <EditOwnerDetailsModal
        open={editOwnerOpen}
        onClose={() => setEditOwnerOpen(false)}
        tenant={tenant}
        token={token}
        onSaved={handleSaved}
      />

      <EditAddressModal
        open={editAddressOpen}
        onClose={() => setEditAddressOpen(false)}
        tenant={tenant}
        token={token}
        onSaved={handleSaved}
        onOpenBusinessDetails={() => setEditBusinessOpen(true)}
      />
    </div>
  );
}

/* -----------------------------------------------------------------------------
   MODAL: Edit Business Details
----------------------------------------------------------------------------- */
function EditBusinessDetailsModal({
  open,
  onClose,
  tenant,
  token,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tenant: any;
  token: string | null;
  onSaved: () => void;
}) {
  const [storeName, setStoreName] = useState('');
  const [country, setCountry] = useState('Bangladesh');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && tenant) {
      setStoreName(tenant.name || '');
      setCountry(tenant.restaurantInfo?.country || 'Bangladesh');
    }
  }, [open, tenant]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await updateTenant(
        {
          name: storeName,
          restaurantInfo: {
            ...tenant?.restaurantInfo,
            country,
          },
        },
        token
      );
      toastSuccess('Restaurant details updated');
      onSaved();
      onClose();
    } catch (err) {
      toastError('Failed to save business details');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit restaurant details" size="md">
      <div className="flex flex-col">
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="text-[15px] font-semibold text-slate-900">Edit restaurant details</div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Restaurant name</label>
            <input
              className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="e.g. My Restaurant"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Country/region</label>
            <select
              className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="Bangladesh">Bangladesh</option>
              <option value="Afghanistan">Afghanistan</option>
              <option value="United States">United States</option>
              <option value="United Kingdom">United Kingdom</option>
              <option value="India">India</option>
              <option value="Pakistan">Pakistan</option>
            </select>
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-200 px-5 py-4 flex items-center justify-end gap-2 bg-slate-50/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#e2e2e2] bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !storeName.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* -----------------------------------------------------------------------------
   MODAL: Edit Restaurant Contact Details
----------------------------------------------------------------------------- */
function EditRestaurantContactModal({
  open,
  onClose,
  tenant,
  token,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tenant: any;
  token: string | null;
  onSaved: () => void;
}) {
  const { user } = useAuthContext();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && tenant) {
      setEmail(tenant.restaurantInfo?.email || user?.email || '');
      setPhone(tenant.restaurantInfo?.phone || tenant.ownerInfo?.phone || '');
    }
  }, [open, tenant, user]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await updateTenant(
        {
          restaurantInfo: {
            ...tenant?.restaurantInfo,
            email,
            phone,
          },
        },
        token
      );
      toastSuccess('Restaurant contact details updated');
      onSaved();
      onClose();
    } catch (err) {
      toastError('Failed to save restaurant contact details');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit contact details" size="md">
      <div className="flex flex-col">
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="text-[15px] font-semibold text-slate-900">Edit contact details</div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Email address</label>
            <input
              type="email"
              className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. contact@restaurant.com"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Phone number</label>
            <input
              type="text"
              className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +8801712244604"
            />
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-200 px-5 py-4 flex items-center justify-end gap-2 bg-slate-50/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#e2e2e2] bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !email.trim() || !phone.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* -----------------------------------------------------------------------------
   MODAL: Edit Owner Details
----------------------------------------------------------------------------- */
function EditOwnerDetailsModal({
  open,
  onClose,
  tenant,
  token,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tenant: any;
  token: string | null;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && tenant) {
      setFullName(tenant.ownerInfo?.fullName || '');
      setPhone(tenant.ownerInfo?.phone || '');
    }
  }, [open, tenant]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await updateTenant(
        {
          ownerInfo: {
            fullName,
            phone,
          },
        },
        token
      );
      toastSuccess('Owner details updated');
      onSaved();
      onClose();
    } catch (err) {
      toastError('Failed to save owner details');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit owner details" size="md">
      <div className="flex flex-col">
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="text-[15px] font-semibold text-slate-900">Edit owner details</div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Owner name</label>
            <input
              className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Alvi Noman"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Phone number</label>
            <input
              className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +8801712244604"
            />
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-200 px-5 py-4 flex items-center justify-end gap-2 bg-slate-50/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#e2e2e2] bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !fullName.trim() || !phone.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* -----------------------------------------------------------------------------
   MODAL: Edit Store Address
----------------------------------------------------------------------------- */
function EditAddressModal({
  open,
  onClose,
  tenant,
  token,
  onSaved,
  onOpenBusinessDetails,
}: {
  open: boolean;
  onClose: () => void;
  tenant: any;
  token: string | null;
  onSaved: () => void;
  onOpenBusinessDetails: () => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [country, setCountry] = useState('Bangladesh');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && tenant) {
      setCompanyName(tenant.name || '');
      setCountry(tenant.restaurantInfo?.country || 'Bangladesh');
      
      const addrStr = tenant.restaurantInfo?.address || '';
      
      if (addrStr.includes(';')) {
        const parts = addrStr.split(';');
        const getVal = (prefix: string) => {
          const matched = parts.find((p: string) => p.toLowerCase().startsWith(prefix.toLowerCase()));
          return matched ? matched.substring(prefix.length).trim() : '';
        };
        const region = getVal('Region:');
        const union = getVal('Union:');
        const upazila = getVal('Upazila/Thana:');
        const district = getVal('District:');
        const division = getVal('Division:');
        
        setLine1(region || union || '');
        setLine2(upazila || '');
        setCity(district || division || '');
        setPostalCode('1205'); // fallback
      } else {
        const parts = addrStr.split(',').map((p: string) => p.trim());
        if (parts.length >= 4) {
          setLine1(parts.slice(0, parts.length - 3).join(', '));
          setLine2('');
          setCity(parts[parts.length - 3]);
          setPostalCode(parts[parts.length - 2]);
        } else {
          setLine1(addrStr);
          setLine2('');
          setCity('');
          setPostalCode('');
        }
      }
    }
  }, [open, tenant]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    
    const fullAddress = [line1, line2, city, postalCode, country]
      .filter(Boolean)
      .join(', ');

    try {
      await updateTenant(
        {
          name: companyName,
          restaurantInfo: {
            ...tenant?.restaurantInfo,
            address: fullAddress,
          },
        },
        token
      );
      toastSuccess('Restaurant address updated');
      onSaved();
      onClose();
    } catch (err) {
      toastError('Failed to save address');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit restaurant address" size="lg">
      <div className="flex flex-col text-slate-800">
        <div className="shrink-0 border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Edit restaurant address</h3>
            <p className="text-[12px] text-slate-500 mt-0.5 font-sans font-normal">Your customers can see this information</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Restaurant name</label>
            <input
              className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Country/region</label>
            <div className="flex items-center justify-between rounded-lg border border-[#e2e2e2] bg-[#f8f9fa] px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-lg">{getFlagEmoji(country)}</span>
                <span className="text-slate-700">{country}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenBusinessDetails();
                }}
                className="text-xs text-slate-600 underline hover:text-slate-900 font-medium"
              >
                Change country in restaurant details
              </button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Address</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                className="w-full rounded-lg border border-[#e2e2e2] pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder="House No. 101/4, Crescent Road, Kathalbagan"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Apartment, suite, etc</label>
            <input
              className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
              value={line2}
              onChange={(e) => setLine2(e.target.value)}
              placeholder="e.g. Apartment 4B"
            />
          </div>

          <div className="grid gap-4 grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-slate-700">City</label>
              <input
                className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Dhaka"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-slate-700">Postal code</label>
              <input
                className="rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm bg-white focus:outline-none focus:border-slate-800"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="1205"
              />
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 px-5 py-4 flex items-center justify-end gap-2 bg-slate-50/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#e2e2e2] bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !line1.trim() || !city.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
