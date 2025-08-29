import {
  useEffect,
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
import Counter from './Counter';
import ImageUploadZone from './ImageUploadZone';
import Tags from './Tags';

export default function ProductDrawer({
  title,
  categories,
  initial,
  onClose,
  onSubmit,
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
    imagePreview?: string | null;
    imagePreview2?: string | null;
    imagePreviews?: (string | null)[]; // optional array form; if present, it will be used
  };
  onClose: () => void;
  onSubmit: (values: { name: string; price: number; description?: string; category?: string }) => void;
}) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const { token } = useAuthContext();
  const queryClient = useQueryClient();

  // Build initial previews array (max 5)
  const initPreviews = (() => {
    if (Array.isArray(initial.imagePreviews) && initial.imagePreviews.length) {
      return initial.imagePreviews.slice(0, 5);
    }
    const list: (string | null)[] = [];
    if (typeof initial.imagePreview !== 'undefined') list.push(initial.imagePreview || null);
    if (typeof initial.imagePreview2 !== 'undefined' && initial.imagePreview2 !== null) list.push(initial.imagePreview2);
    return list.length ? list.slice(0, 5) : [null];
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

  const [localError, setLocalError] = useState<string | null>(null);
  const [localCats, setLocalCats] = useState<string[]>(categories);

  useEffect(() => setLocalCats(categories), [categories]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const createCatMut = useMutation<Category, Error, string>({
    mutationFn: (name) => apiCreateCategory(name, token || ''),
    onSuccess: (created) => {
      setLocalCats((prev) => (prev.includes(created.name) ? prev : [...prev, created.name].sort()));
      setValues((prev) => ({ ...prev, category: created.name }));

      queryClient.setQueryData<Category[]>(
        ['categories', token],
        (prev) => {
          const list = prev ?? [];
          const exists = list.some((c) => c.name === created.name);
          return exists ? list : [...list, created].sort((a, b) => a.name.localeCompare(b.name));
        }
      );

      try {
        localStorage.setItem('categories:updated', String(Date.now()));
      } catch {}
      queryClient.invalidateQueries({ queryKey: ['categories', token] });
    },
  });

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      try {
        values.imagePreviews?.forEach((u) => {
          if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
        });
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toNumber = (v: string) => Number(v);
  const priceNum = toNumber(values.price);
  const isFormValid =
    values.name.trim().length > 0 && !Number.isNaN(priceNum) && priceNum > 0 && !!values.category;

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!isFormValid) {
      if (!values.name.trim()) return setLocalError('Name is required.');
      if (Number.isNaN(priceNum) || priceNum <= 0)
        return setLocalError('Price must be a valid positive number.');
      if (!values.category) return setLocalError('Please select a category.');
    }
    onSubmit({
      name: values.name.trim(),
      price: priceNum,
      description: values.description?.trim() || undefined,
      category: values.category,
    });
  };

  // Helpers for gallery
  const handlePickAt = (index: number, file: File, previewUrl: string) => {
    setValues((prev) => {
      const nextFiles = prev.imageFiles.slice();
      const nextPreviews = prev.imagePreviews.slice();

      // Revoke old blob if present
      const prevUrl = nextPreviews[index];
      if (prevUrl && prevUrl !== previewUrl && prevUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(prevUrl); } catch {}
      }

      // Expand arrays if needed
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
  };

  const handleClearAt = (index: number) => {
    setValues((prev) => {
      const nextPreviews = prev.imagePreviews.slice();
      const toRevoke = nextPreviews[index];
      if (toRevoke?.startsWith('blob:')) {
        try { URL.revokeObjectURL(toRevoke); } catch {}
      }
      nextPreviews.splice(index, 1);
      const nextFiles = prev.imageFiles.slice();
      if (index < nextFiles.length) nextFiles.splice(index, 1);
      return { ...prev, imageFiles: nextFiles, imagePreviews: nextPreviews.length ? nextPreviews : [null] };
    });
  };

  const isSaveDisabled = !isFormValid || createCatMut.isPending;

  return (
    <div className="fixed inset-0 z-50">
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
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
          <button className="text-[#6b7280] hover:text-[#374151]" onClick={onClose} aria-label="Close">
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
                  const v = (e.currentTarget as HTMLInputElement).value;
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
                  value={values.price}
                  onChange={(v: string) => setValues((prev) => ({ ...prev, price: v }))}
                  placeholder="0.00"
                />
              </Field>

              <Field>
                <LabelRow
                  text="Compare-at Price"
                  help={'To display a markdown, enter a value higher than your price.\nOften shown with a strikethrough.'}
                  placement="left"
                />
                <CurrencyInput
                  value={values.compareAtPrice || ''}
                  onChange={(v: string) => setValues((prev) => ({ ...prev, compareAtPrice: v }))}
                  placeholder="0.00"
                />
              </Field>
            </div>

            <Field>
              <CategorySelect
                label="Category"
                value={values.category || ''}
                categories={localCats}
                onChange={(val: string) => setValues((prev) => ({ ...prev, category: val }))}
                onCreateCategory={async (name: string) => {
                  const created = await createCatMut.mutateAsync(name);
                  return created.name;
                }}
                placeholder="Select a Category"
              />
            </Field>

            <Field>
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={values.description || ''}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLTextAreaElement).value;
                  setValues((prev) => ({ ...prev, description: v }));
                }}
                placeholder="Describe the dish: key ingredients, flavor profile, spice level, portion size, and any allergens."
              />
            </Field>

            {/* Media */}
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

            <Variations helpText="Add options like Size, Spice Level, or Toppings" />

            <Field>
              <Tags />
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
              isSaveDisabled ? 'bg-[#b0b0b5] cursor-not-allowed' : 'bg-[#111827] hover:opacity-90'
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

/**
 * @param {{ children: ReactNode }} props
 */
function Field({ children }: { children: ReactNode }) {
  return <div className="text-[#2e2e30]">{children}</div>;
}

/**
 * @param {{ children: ReactNode; className?: string }} props
 */
function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <label className={`block text-sm font-medium text-[#2e2e30] mb-1 ${className}`}>{children}</label>;
}

/**
 * @param {{ text: string; help?: string; placement?: 'bottom'|'left'|'right' }} props
 */
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

/**
 * @param {{ label: string; placement?: 'bottom'|'left'|'right' }} props
 */
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

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full border border-[#dbdbdb] hover:border-[#111827] focus:border-[#111827] transition-colors rounded-md px-3 py-2 bg-[#fcfcfc] text-sm placeholder-[#a9a9ab] focus:outline-none focus:ring-0 text-[#2e2e30] ${className || ''}`}
    />
  );
}

function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`w-full border border-[#dbdbdb] hover:border-[#111827] focus:border-[#111827] transition-colors rounded-md px-3 py-2 bg-[#fcfcfc] text-sm placeholder-[#a9a9ab] focus:outline-none focus:ring-0 text-[#2e2e30] ${className || ''}`}
    />
  );
}

/**
 * @param {{ value: string; onChange: (val: string) => void; placeholder?: string }} props
 */
function CurrencyInput({
  value,
  onChange,
  placeholder = '0.00',
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-stretch">
      <span className="px-2 py-2 border border-[#dbdbdb] border-r-0 rounded-l-md bg-[#fcfcfc] text-sm text-[#6b7280] select-none">
        ৳
      </span>
      <input
        className="w-full border border-[#dbdbdb] border-l-[#dbdbdb] hover:border-[#111827] hover:border-l-[#111827] focus:border-[#111827] focus:border-l-[#111827] transition-colors rounded-r-md px-3 py-2 text-sm placeholder-[#a9a9ab] focus:outline-none focus:ring-0 bg-[#fcfcfc] text-[#2e2e30]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        inputMode="decimal"
      />
    </div>
  );
}