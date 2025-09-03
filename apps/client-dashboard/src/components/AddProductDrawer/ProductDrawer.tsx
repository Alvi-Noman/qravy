/**
 * Product drawer with variant-aware price UI, submit debounce,
 * and 10s snapshot persistence on accidental close
 */
import {
  useEffect,
  useMemo,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../../context/AuthContext';
import CategorySelect from './CategorySelect';
import { createCategory as apiCreateCategory, type Category } from '../../api/categories';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import Variations from './Variations';
import ImageUploadZone from './ImageUploadZone';
import Tags from './Tags';

type UiVariation = { label: string; price?: string; imagePreview?: string | null };

export default function ProductDrawer({
  title,
  categories,
  initial,
  onClose,
  onSubmit,
  persistKey,
}: {
  title: string;
  categories: string[];
  initial: {
    name: string;
    price: string;
    compareAtPrice?: string;
    description?: string;
    category?: string;
    prepMinutes?: number;
    imagePreviews?: (string | null)[];
    tags?: string[];
    variations?: UiVariation[];
  };
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    price?: number;
    compareAtPrice?: number;
    description?: string;
    category?: string;
    media?: string[];
    variations?: { name: string; price?: number; imageUrl?: string }[];
    tags?: string[];
  }) => void;
  persistKey?: string;
}) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const { token } = useAuthContext();
  const queryClient = useQueryClient();

  const STORAGE_TTL_MS = 10_000;
  const storageKey = useMemo(() => `pdraft:${persistKey || 'add'}`, [persistKey]);

  const initPreviews = (() => {
    const list = Array.isArray(initial.imagePreviews) ? initial.imagePreviews.slice(0, 5) : [];
    return list.length ? list : [null];
  })();

  const [values, setValues] = useState(() => ({
    name: initial.name,
    price: initial.price,
    description: initial.description || '',
    category: initial.category || '',
    compareAtPrice: initial.compareAtPrice || '',
    prepMinutes: initial.prepMinutes ?? 15,
    imageFiles: [] as (File | null)[],
    imagePreviews: initPreviews as (string | null)[],
  }));

  const [remoteUrls, setRemoteUrls] = useState<string[]>(
    (initial.imagePreviews || []).map((u) => (u && !u.startsWith('blob:') ? u : '')).slice(0, 5)
  );
  const [tags, setTags] = useState<string[]>(initial.tags || []);
  const [uiVariations, setUiVariations] = useState<UiVariation[]>(initial.variations || []);

  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localCats, setLocalCats] = useState<string[]>(categories);

  useEffect(() => setLocalCats(categories), [categories]);

  /** Restore snapshot if present and not expired */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const snap = JSON.parse(raw) as {
        t: number;
        ttl: number;
        values?: typeof values;
        tags?: string[];
        uiVariations?: UiVariation[];
        remoteUrls?: string[];
      };
      if (!snap?.t || Date.now() - snap.t > (snap.ttl || STORAGE_TTL_MS)) {
        sessionStorage.removeItem(storageKey);
        return;
      }
      const savedValues = snap.values;
      if (savedValues) {
        setValues((prev) => ({
          ...prev,
          ...savedValues,
          imagePreviews: Array.isArray(savedValues.imagePreviews)
            ? savedValues.imagePreviews
            : prev.imagePreviews,
        }));
      }
      if (Array.isArray(snap.tags)) setTags(snap.tags);
      if (Array.isArray(snap.uiVariations)) setUiVariations(snap.uiVariations);
      if (Array.isArray(snap.remoteUrls)) setRemoteUrls(snap.remoteUrls);
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        saveSnapshot();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, values, tags, uiVariations, remoteUrls, storageKey]);

  const createCatMut = useMutation<Category, Error, string>({
    mutationFn: (name) => apiCreateCategory(name, token || ''),
    onSuccess: (created) => {
      setLocalCats((prev) => (prev.includes(created.name) ? prev : [...prev, created.name].sort()));
      setValues((prev) => ({ ...prev, category: created.name }));
      queryClient.invalidateQueries({ queryKey: ['categories', token] });
      try {
        localStorage.setItem('categories:updated', String(Date.now()));
      } catch {}
    },
  });

  useEffect(() => {
    return () => {
      try {
        values.imagePreviews?.forEach((u) => {
          if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
        });
      } catch {}
    };
  }, []);

  const toNumber = (v: string) => Number(v);
  const priceNum = toNumber(values.price);
  const compareAtNum = values.compareAtPrice ? Number(values.compareAtPrice) : undefined;

  const hasVariantPrice = useMemo(
    () =>
      (uiVariations || []).some((v) => {
        const n = v.price ? Number(v.price) : NaN;
        return Number.isFinite(n) && n > 0;
      }),
    [uiVariations]
  );
  const hasMainPrice = Number.isFinite(priceNum) && priceNum > 0;
  const allowMainPrice = !hasVariantPrice;

  const isFormValid =
    values.name.trim().length > 0 &&
    (hasMainPrice || hasVariantPrice) &&
    (allowMainPrice
      ? compareAtNum === undefined || (!Number.isNaN(compareAtNum) && compareAtNum >= priceNum)
      : true);

  /** Persist current state with 10s TTL */
  function saveSnapshot() {
    try {
      const snap = {
        t: Date.now(),
        ttl: STORAGE_TTL_MS,
        values,
        tags,
        uiVariations,
        remoteUrls,
      };
      sessionStorage.setItem(storageKey, JSON.stringify(snap));
    } catch {}
  }

  /** Remove snapshot */
  function clearSnapshot() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    if (saving) return;
    setLocalError(null);

    if (!isFormValid) {
      if (!values.name.trim()) return setLocalError('Name is required.');
      if (!hasMainPrice && !hasVariantPrice)
        return setLocalError('Enter a product price or at least one variation price.');
      if (allowMainPrice && compareAtNum !== undefined && (Number.isNaN(compareAtNum) || compareAtNum < priceNum))
        return setLocalError('Compare-at price must be ≥ product price.');
    }

    const media: string[] = [];
    const maxLen = Math.max(values.imagePreviews.length, remoteUrls.length);
    for (let i = 0; i < maxLen; i++) {
      const u = remoteUrls[i] || values.imagePreviews[i] || '';
      if (u && !u.startsWith('blob:')) media.push(u);
    }

    const variations =
      uiVariations
        .filter((v) => v.label.trim() !== '')
        .map((v) => {
          const p = v.price ? Number(v.price) : undefined;
          return {
            name: v.label.trim(),
            price: p !== undefined && Number.isFinite(p) && p >= 0 ? p : undefined,
            imageUrl: undefined,
          };
        }) || [];

    const payload: Parameters<typeof onSubmit>[0] = {
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      category: values.category || undefined,
      media: media.length ? media : undefined,
      variations: variations.length ? variations : undefined,
      tags: tags.length ? tags : undefined,
    };

    if (allowMainPrice && hasMainPrice) {
      payload.price = priceNum;
      if (compareAtNum !== undefined) payload.compareAtPrice = compareAtNum;
    }

    clearSnapshot();
    setSaving(true);
    onSubmit(payload);
    setTimeout(() => setSaving(false), 1200);
  };

  const handleBackdropClick = () => {
    saveSnapshot();
    onClose();
  };

  const handlePickAt = (index: number, file: File, previewUrl: string) => {
    setValues((prev) => {
      const nextFiles = prev.imageFiles.slice();
      const nextPreviews = prev.imagePreviews.slice();
      const prevUrl = nextPreviews[index];
      if (prevUrl && prevUrl !== previewUrl && prevUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(prevUrl);
        } catch {}
      }
      while (nextFiles.length <= index) nextFiles.push(null);
      while (nextPreviews.length <= index) nextPreviews.push(null);
      nextFiles[index] = file;
      nextPreviews[index] = previewUrl;
      return { ...prev, imageFiles: nextFiles, imagePreviews: nextPreviews };
    });
  };

  const handleUploadedAt = (index: number, url: string) => {
    setValues((prev) => {
      const next = prev.imagePreviews.slice();
      while (next.length <= index) next.push(null);
      next[index] = url;
      return { ...prev, imagePreviews: next };
    });
    setRemoteUrls((prev) => {
      const next = prev.slice();
      while (next.length <= index) next.push('');
      next[index] = url;
      return next;
    });
  };

  const handleClearAt = (index: number) => {
    setValues((prev) => {
      const nextPreviews = prev.imagePreviews.slice();
      const toRevoke = nextPreviews[index];
      if (toRevoke?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(toRevoke);
        } catch {}
      }
      nextPreviews.splice(index, 1);
      const nextFiles = prev.imageFiles.slice();
      if (index < nextFiles.length) nextFiles.splice(index, 1);
      return { ...prev, imageFiles: nextFiles, imagePreviews: nextPreviews.length ? nextPreviews : [null] };
    });
    setRemoteUrls((prev) => {
      const next = prev.slice();
      next.splice(index, 1);
      return next;
    });
  };

  const isSaveDisabled = !isFormValid || createCatMut.isPending || saving;

  return (
    <div className="fixed inset-0 z-50">
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleBackdropClick}
      />
      <motion.aside
        className="absolute right-0 top-0 h-screen w-full sm:w-[460px] md:w-[520px] bg-[#f5f5f5] border-l border-[#dbdbdb] shadow-2xl flex flex-col overflow-x-hidden"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
        aria-modal="true"
        role="dialog"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#dbdbdb] sticky top-0 bg-[#fcfcfc]">
          <h3 className="text-lg font-semibold text-[#2e2e30]">{title}</h3>
          <button
            className="text-[#6b7280] hover:text-[#374151]"
            onClick={handleBackdropClick}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form id="product-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 bg-[#fcfcfc]">
          <div className="space-y-5">
            <Field>
              <Label>Item Name</Label>
              <Input
                value={values.name}
                onChange={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  setValues((prev) => ({ ...prev, name: v }));
                }}
                placeholder="e.g., Chicken Biryani"
                required
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <LabelRow text="Price" />
                <CurrencyInput
                  value={hasVariantPrice ? '' : values.price}
                  onChange={(v: string) => setValues((prev) => ({ ...prev, price: v }))}
                  placeholder={hasVariantPrice ? 'Set by Variant' : '0.00'}
                  disabled={hasVariantPrice}
                />
              </Field>

              {!hasVariantPrice && (
                <Field>
                  <LabelRow
                    text="Compare-at Price"
                    help="Enter a value higher than your product price to show a markdown."
                    placement="left"
                  />
                  <CurrencyInput
                    value={values.compareAtPrice || ''}
                    onChange={(v: string) => setValues((prev) => ({ ...prev, compareAtPrice: v }))}
                    placeholder="0.00"
                    disabled={!hasMainPrice}
                  />
                </Field>
              )}
            </div>

            <Field>
              <CategorySelect
                label="Category"
                value={values.category || ''}
                categories={localCats}
                onChange={(val: string) => setValues((prev) => ({ ...prev, category: val }))}
                onCreateCategory={async (name: string) => (await createCatMut.mutateAsync(name)).name}
                placeholder="Select a Category"
              />
            </Field>

            <Field>
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={values.description || ''}
                onChange={(e) => {
                  const v = (e.target as HTMLTextAreaElement).value;
                  setValues((prev) => ({ ...prev, description: v }));
                }}
                placeholder="Describe the dish (optional)."
              />
            </Field>

            <Field>
              <Label className="mb-2">Media</Label>
              <ImageUploadZone
                previews={values.imagePreviews}
                maxCount={5}
                uploadUrl={`${API_BASE}/api/uploads/images`}
                authToken={token || undefined}
                onPick={(i, file, url) => handlePickAt(i, file, url)}
                onUploaded={(i, resp) => handleUploadedAt(i, resp.cdn.medium)}
                onClear={(i) => handleClearAt(i)}
              />
            </Field>

            <Variations value={uiVariations} onChange={setUiVariations} />

            <Field>
              <Tags value={tags} onChange={setTags} />
            </Field>

            {(localError || createCatMut.isError) && (
              <div className="text-sm text-red-600">
                {localError || (createCatMut.error as Error)?.message || 'Something went wrong.'}
              </div>
            )}
          </div>
        </form>

        <div className="px-5 py-4 border-t border-[#dbdbdb] sticky bottom-0 bg-[#fcfcfc] flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-md border border-[#dbdbdb] hover:border-[#111827] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="product-form"
            className={`px-4 py-2 rounded-md text-sm text-white ${
              isSaveDisabled ? 'bg-[#b0b0b5] cursor-not-allowed' : saving ? 'bg-[#111827] cursor-wait' : 'bg-[#111827] hover:opacity-90'
            }`}
            disabled={isSaveDisabled}
          >
            Save Changes
          </button>
        </div>
      </motion.aside>
    </div>
  );
}

/** Field wrapper */
function Field({ children }: { children: ReactNode }) {
  return <div className="text-[#2e2e30]">{children}</div>;
}

/** Label */
function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <label className={`block text-sm font-medium text-[#2e2e30] mb-1 ${className}`}>{children}</label>;
}

/** Label row with help */
function LabelRow({
  text,
  help,
  placement = 'bottom',
}: {
  text: string;
  help?: string;
  placement?: 'bottom' | 'left' | 'right';
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1 h-5">
      <span className="text-sm font-medium text-[#2e2e30] leading-none">{text}</span>
      {help && (
        <span className="relative inline-flex items-center align-middle group cursor-pointer">
          <QuestionMarkCircleIcon className="h-4 w-4 text-[#6b7280] group-hover:text-[#374151]" />
          <HoverCard label={help} placement={placement} />
        </span>
      )}
    </div>
  );
}

/** Hover card */
function HoverCard({
  label,
  placement = 'bottom',
}: {
  label: string;
  placement?: 'bottom' | 'left' | 'right';
}) {
  const pos =
    placement === 'left'
      ? 'right-full mr-2 top-1/2 -translate-y-1/2'
      : placement === 'right'
      ? 'left-full ml-2 top-1/2 -translate-y-1/2'
      : 'left-0 top-full mt-1';
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute ${pos} z-50 w-80 max-w-[22rem] rounded-md border border-[#dbdbdb] bg-[#fcfcfc] text-[#2e2e30] text-xs px-3 py-2 shadow-md opacity-0 translate-y-0 group-hover:opacity-100 group-hover:translate-y-[2px] transition duration-150 ease-out`}
    >
      {label}
    </span>
  );
}

/** Input */
function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full border border-[#dbdbdb] hover:border-[#111827] focus:border-[#111827] transition-colors rounded-md px-3 py-2 bg-[#fcfcfc] text-sm placeholder-[#a9a9ab] focus:outline-none focus:ring-0 text-[#2e2e30] ${className || ''}`}
    />
  );
}

/** Textarea */
function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`w-full border border-[#dbdbdb] hover:border-[#111827] focus:border-[#111827] transition-colors rounded-md px-3 py-2 bg-[#fcfcfc] text-sm placeholder-[#a9a9ab] focus:outline-none focus:ring-0 text-[#2e2e30] ${className || ''}`}
    />
  );
}

/** Currency input */
function CurrencyInput({
  value,
  onChange,
  placeholder = '0.00',
  disabled = false,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-stretch">
      <span className="px-2 py-2 border border-[#dbdbdb] border-r-0 rounded-l-md bg-[#fcfcfc] text-sm text-[#6b7280] select-none">
        ৳
      </span>
      <input
        className={`w-full border border-[#dbdbdb] border-l-[#dbdbdb] hover:border-[#111827] hover:border-l-[#111827] focus:border-[#111827] focus:border-l-[#111827] transition-colors rounded-r-md px-3 py-2 text-sm placeholder-[#a9a9ab] focus:outline-none focus:ring-0 bg-[#fcfcfc] text-[#2e2e30] ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
        inputMode="decimal"
      />
    </div>
  );
}