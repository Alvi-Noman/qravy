import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { AnimatePresence, motion } from 'framer-motion';

type FormValues = { name: string };

export default function CategoryFormDialog({
  open,
  title,
  initialName = '',
  existingNames = [],
  onClose,
  onSubmit,
  isSubmitting = false,
}: {
  open: boolean;
  title: string;
  initialName?: string;
  existingNames?: string[];
  onClose: () => void;
  onSubmit: (name: string) => void;
  isSubmitting?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<FormValues>({
    defaultValues: { name: initialName },
    mode: 'onChange',
  });

  useEffect(() => {
    if (open) reset({ name: initialName });
  }, [open, initialName, reset]);

  const validateUnique = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return 'Name is required.';
    if (existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      return 'A category with this name already exists.';
    }
    return true;
  };

  const submit = (v: FormValues) => {
    onSubmit(v.name.trim());
  };

  const busy = isSubmitting || rhfSubmitting;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <motion.form
            onSubmit={handleSubmit(submit)}
            initial={{ scale: 0.98, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-md rounded-lg border border-[#ececec] bg-white p-5 shadow-lg"
          >
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-[#2e2e30]">{title}</h3>
              <p className="text-sm text-[#6b6b70]">Give it a clear, concise name.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-[#5b5b5d]" htmlFor="category-name">
                Category name
              </label>
              <input
                id="category-name"
                {...register('name', { validate: validateUnique })}
                placeholder="e.g. Starters"
                autoFocus
                className="w-full rounded-md border border-[#cecece] bg-white px-3 py-2 text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#e0e0e5]"
              />
              {errors.name?.message ? (
                <div className="text-sm text-red-600">{errors.name.message}</div>
              ) : null}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-[#cecece] px-4 py-2 text-sm hover:bg-[#f5f5f5] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}