import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, PlusCircleIcon } from '@heroicons/react/24/outline';

type CategorySelectProps = {
  value: string | '';
  categories: string[];
  onChange: (value: string) => void;
  onCreateCategory: (name: string) => Promise<string>; // should return the created category name
  placeholder?: string;
  disabled?: boolean;
  label?: string;
};

export default function CategorySelect({
  value,
  categories,
  onChange,
  onCreateCategory,
  placeholder = 'Uncategorized',
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
      onChange(createdName);
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

  return (
    <div className="relative" ref={rootRef}>
      {label && (
        <label className="block text-sm font-medium mb-1">
          {label}
          {categories.length === 0 && (
            <span className="ml-2 text-xs text-[#9b9ba1]">(no categories yet)</span>
          )}
        </label>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`w-full border border-[#cecece] rounded-md px-3 py-2 bg-white text-left flex items-center justify-between ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#f7f7f9]'
        }`}
        aria-expanded={open}
      >
        <span className={`truncate ${value ? 'text-[#2e2e30]' : 'text-[#9b9ba1]'}`}>{display}</span>
        <ChevronDownIcon className="h-5 w-5 text-[#6b6b70]" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-[#ececec] bg-white shadow-lg overflow-hidden">
          <div className="max-h-60 overflow-auto py-1">
            <OptionRow
              selected={value === ''}
              label={placeholder}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            />
            {categories.map((c) => (
              <OptionRow
                key={c}
                selected={value === c}
                label={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              />
            ))}

            <div className="my-1 h-px bg-[#f1f1f3]" />

            {!addMode ? (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#4a56e2] hover:bg-[#f7f8ff]"
                onClick={() => {
                  setAddMode(true);
                  setError(null);
                  setNewName('');
                }}
              >
                <PlusCircleIcon className="h-5 w-5" />
                <span className="font-medium">Add New Category</span>
              </button>
            ) : (
              <div className="px-3 py-2 space-y-2">
                <input
                  className="w-full border border-[#e6e6e9] rounded-md px-3 py-2 bg-[#f7f7fb] placeholder-[#9b9ba1] text-sm"
                  placeholder="Input Category Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                {error && <div className="text-red-600 text-xs">{error}</div>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md border border-[#cecece] text-sm hover:bg-[#f5f5f5]"
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
                      saving ? 'bg-[#b0b0b5]' : 'bg-[#3b5bff] hover:opacity-90'
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
      )}
    </div>
  );
}

function OptionRow({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`w-full text-left px-3 py-2 text-sm ${
        selected ? 'bg-[#eef0ff] text-[#2e2e30]' : 'hover:bg-[#f7f7f9] text-[#2e2e30]'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}