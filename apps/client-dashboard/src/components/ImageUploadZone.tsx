import React, { useRef, useState } from 'react';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';

type ImageUploadZoneProps = {
  preview: string | null;
  onPick: (file: File, previewUrl: string) => void;
  onClear: () => void;
  disabled?: boolean;
  maxSizeMB?: number;
  accept?: string;
  className?: string;
  id?: string;
  name?: string;
  widthClass?: string; // e.g. 'w-56'
};

const ImageUploadZone: React.FC<ImageUploadZoneProps> = ({
  preview,
  onPick,
  onClear,
  disabled = false,
  maxSizeMB,
  accept = 'image/jpeg,image/jp2,image/png,.jpg,.jpeg,.jp2,.png',
  className = '',
  id,
  name,
  widthClass = 'w-56',
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFileDialog = () => !disabled && inputRef.current?.click();

  const handleKey = (e: React.KeyboardEvent) => {
    if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openFileDialog();
    }
  };

  const acceptParts = (accept || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const matchesAccept = (file: File) => {
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return acceptParts.some((p) => {
      if (p.startsWith('.')) return name.endsWith(p);
      if (p.endsWith('/*')) return type.startsWith(p.slice(0, -1));
      return type === p;
    });
  };

  const validate = (file: File) => {
    if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) return `${file.name} exceeds ${maxSizeMB}MB`;
    if (!matchesAccept(file)) return `${file.name} is not a supported type`;
    return null;
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const file = fileList[0];
    const msg = validate(file);
    if (msg) return setError(msg);
    setError(null);
    const url = URL.createObjectURL(file);
    onPick(file, url);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!disabled) handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragOver(false);
  };

  const errorId = error ? 'image-upload-zone-error' : undefined;

  return (
    <div className={`w-full ${className}`}>
      <div className={`relative inline-block ${widthClass}`}>
        {/* One element: dashed border + radius + hover tint */}
        <div
          className={[
            'relative rounded-lg border border-dashed',
            'border-[#dbdbdb]',
            dragOver ? 'bg-[#f3f4f6]' : 'bg-[#fcfcfc] hover:bg-[#f6f6f6]',
            'transition-colors',
          ].join(' ')}
        >
          <div className="pt-[100%]" />

          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-describedby={errorId}
            onClick={openFileDialog}
            onKeyDown={handleKey}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`absolute inset-0 flex items-center justify-center p-4 text-center ${
              disabled ? 'pointer-events-none opacity-60 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <div className="flex flex-col items-center pointer-events-none select-none">
              <CloudArrowUpIcon className="h-7 w-7 text-[#6b7280]" aria-hidden="true" />
              <div className="mt-2 text-sm font-medium text-[#2e2e30]">Drag your Image Here</div>
              <div className="my-1 text-xs text-[#a9a9ab]">or</div>
              <div className="pointer-events-auto">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openFileDialog();
                  }}
                  disabled={disabled}
                  className="inline-flex items-center justify-center min-w-[100px] px-4 py-1.5 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f8f8f8] hover:border-[#bdbdbd] active:bg-[#eceff1] transition-colors text-sm text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#e5e7eb]"
                >
                  Browse
                </button>
              </div>
            </div>
          </div>

          <input
            ref={inputRef}
            id={id}
            name={name}
            type="file"
            accept={accept}
            disabled={disabled}
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {preview && (
        <div className="mt-3 flex items-center gap-3">
          <img
            src={preview}
            alt="Selected preview"
            className="h-20 w-20 object-cover rounded-md border border-[#dbdbdb] bg-[#fcfcfc]"
          />
          <button type="button" onClick={onClear} className="text-sm text-red-600 hover:underline">
            Remove
          </button>
        </div>
      )}

      {error && (
        <p id={errorId} className="mt-2 text-sm text-red-600" role="alert" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
};

export default ImageUploadZone;