import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, PlusCircleIcon } from '@heroicons/react/24/outline';

export type Channel = 'dine-in' | 'online';
export type CategoryLike = {
  name: string;
  channel?: Channel;                 // optional single-channel category
  includeLocationIds?: string[];     // only these locations
  excludeLocationIds?: string[];     // hide at these locations
  disabled?: boolean;                // <-- NEW: allow disabling options
};

type CategorySelectProps = {
  /** currently selected category name (empty string means none) */
  value: string | '';
  /** can be a list of names or full objects with restrictions */
  categories: (string | CategoryLike)[];
  /**
   * onChange remains backward-compatible:
   * - 1st arg: the category name (string)
   * - 2nd arg (optional): full category object if provided in `categories`
   */
  onChange: (value: string, detail?: CategoryLike) => void;
  /** create a new category; should return the created name */
  onCreateCategory: (name: string) => Promise<string>;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
};

export default function CategorySelect({
  value,
  categories,
  onChange,
  onCreateCategory,
  placeholder = 'Select a Category',
  disabled,
  label,
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAddMode(false);
        setNewName('');
        setError(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const createdName = await onCreateCategory(newName.trim());
      // We only know the name at creation time; pass minimal detail
      onChange(createdName, { name: createdName });
      setAddMode(false);
      setNewName('');
      setOpen(false);
    } catch (e) {
      setError((e as Error).message || 'Failed to create category.');
    } finally {
      setSaving(false);
    }
  };

  const display = value || placeholder;
  const isPlaceholder = !value;

  // Normalize categories into a uniform shape for rendering
  const list: CategoryLike[] = categories.map((c) =>
    typeof c === 'string' ? { name: c } : c
  );

  return (
    <div className="relative" ref={rootRef}>
      {label && <label className="block text-sm font-medium text-[#2e2e30] mb-1">{label}</label>}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full border border-[#dbdbdb] hover:border-[#111827] transition-colors rounded-md px-3 py-2 bg-[#fcfcfc] text-left flex items-center justify-between text-sm ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#f6f6f6]'
        }`}
      >
        <span className={`truncate ${isPlaceholder ? 'text-[#a9a9ab]' : 'text-[#2e2e30]'}`}>{display}</span>
        <ChevronDownIcon className="h-5 w-5 text-[#6b7280]" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-[100] mt-1">
          <div className="w-full rounded-md border border-[#dbdbdb] bg-[#fcfcfc] shadow-lg overflow-visible">
            <div className="py-1">
              {list.map((c) => (
                <OptionRow
                  key={c.name}
                  selected={value === c.name}
                  label={c.name}
                  disabled={!!c.disabled}
                  title={c.disabled ? 'Disabled by selected category' : undefined}
                  onClick={() => {
                    if (c.disabled) return;
                    onChange(c.name, c); // pass both name and full detail
                    setOpen(false);
                  }}
                />
              ))}
              {list.length === 0 && (
                <div className="px-3 py-2 text-sm text-[#a9a9ab] select-none cursor-default">No categories yet</div>
              )}
              <div className="my-1 h-px bg-[#dbdbdb]" />
              {!addMode ? (
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#2e2e30] hover:bg-[#f3f4f6] transition-colors"
                  onClick={() => {
                    setAddMode(true);
                    setError(null);
                    setNewName('');
                  }}
                >
                  <PlusCircleIcon className="h-5 w-5 text-[#2e2e30]" />
                  <span className="font-medium">Add New Category</span>
                </button>
              ) : (
                <div className="px-3 py-2 space-y-2">
                  <input
                    className="w-full border border-[#dbdbdb] hover:border-[#111827] focus:border-[#111827] transition-colors rounded-md px-3 py-2 bg-[#fcfcfc] placeholder-[#a9a9ab] text-sm focus:outline-none focus:ring-0 text-[#2e2e30]"
                    placeholder="Input Category Name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                  />
                  {error && <div className="text-red-600 text-xs">{error}</div>}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f3f4f6] transition-colors text-sm text-[#2e2e30]"
                      onClick={() => {
                        setAddMode(false);
                        setNewName('');
                        setError(null);
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreate}
                      className={`px-4 py-1.5 rounded-md text-white text-sm ${
                        saving || !newName.trim()
                          ? 'bg-[#b0b0b5] cursor-not-allowed'
                          : 'bg-[#111827] hover:opacity-90'
                      }`}
                      disabled={saving || !newName.trim()}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionRow({
  selected,
  label,
  onClick,
  disabled,
  title,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={disabled ? title : undefined}
      className={`w-full text-left px-3 py-2 text-sm ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : selected
          ? 'bg-[#eef0ff] text-[#2e2e30]'
          : 'hover:bg-[#f3f4f6] text-[#2e2e30]'
      }`}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
