import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, PlusCircleIcon } from '@heroicons/react/24/outline';

type CategorySelectProps = {
  value: string | '';
  categories: string[];
  onChange: (value: string) => void;
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
  const isPlaceholder = !value;

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
              {categories.length === 0 && (
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
                      className={`px-4 py-1.5 rounded-md text-white text-sm ${saving || !newName.trim() ? 'bg-[#b0b0b5] cursor-not-allowed' : 'bg-[#111827] hover:opacity-90'}`}
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

function OptionRow({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`w-full text-left px-3 py-2 text-sm ${selected ? 'bg-[#eef0ff] text-[#2e2e30]' : 'hover:bg-[#f3f4f6] text-[#2e2e30]'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}