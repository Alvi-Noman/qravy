import { useRef, useState } from 'react';
import Modal from '../Modal';
import { addPaymentMethod, type PaymentMethod } from '../../api/billing';

export default function AddCardModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (pm: PaymentMethod) => void;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [card, setCard] = useState('');
  const [expMonth, setExpMonth] = useState('12');
  const [expYear, setExpYear] = useState(String(new Date().getFullYear() + 4));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Match TopbarSearch border behavior
  const fieldCls =
    'rounded-md border border-[#dbdbdb] px-2 py-2 text-sm transition-colors focus:outline-none focus:border-[#111827]';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const digits = card.replace(/\D/g, '');
    if (digits.length < 12) {
      setError('Enter a valid card number (mock).');
      return;
    }
    setSaving(true);
    try {
      const pm = await addPaymentMethod(digits);
      onAdded({ ...pm, expMonth: Number(expMonth), expYear: Number(expYear) });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add card" size="md" initialFocusRef={firstRef}>
      <form onSubmit={onSubmit}>
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-[14px] font-semibold text-slate-900">Add card</div>
        </div>

        <div className="grid gap-3 px-4 py-4">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Card number</label>
            <input
              ref={firstRef}
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="4242 4242 4242 4242"
              value={card}
              onChange={(e) => setCard(e.target.value)}
              className={fieldCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-slate-700">Expiry month</label>
              <input
                inputMode="numeric"
                value={expMonth}
                onChange={(e) => setExpMonth(e.target.value)}
                className={fieldCls}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium text-slate-700">Expiry year</label>
              <input
                inputMode="numeric"
                value={expYear}
                onChange={(e) => setExpYear(e.target.value)}
                className={fieldCls}
              />
            </div>
          </div>

          {error && <div className="text-[12px] text-rose-700">{error}</div>}

          <div className="text-[12px] text-slate-600">
            Demo only. In production, use Stripe Elements or your PSP’s PCI-compliant form.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button disabled={saving} type="submit" className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white">
            {saving ? 'Adding…' : 'Add card'}
          </button>
        </div>
      </form>
    </Modal>
  );
}