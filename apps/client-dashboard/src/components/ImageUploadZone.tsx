import React, { useRef, useState, useEffect } from 'react';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';

/**
 * @typedef {{ original: string; thumbnail: string; medium: string; large: string }} CdnUrls
 */

/** Types for TS */
type CdnUrls = { original: string; thumbnail: string; medium: string; large: string };
type UploadResponse = { ok: boolean; key: string; hash: string; mime: string; size: number; cdn: CdnUrls };

/**
 * @param {{
 *   preview: string | null;
 *   onPick?: (file: File, previewUrl: string) => void;
 *   onClear?: () => void;
 *   onUploaded?: (resp: UploadResponse) => void;
 *   uploadUrl: string;
 *   authToken?: string;
 *   disabled?: boolean;
 *   maxSizeMB?: number;
 *   accept?: string;
 *   className?: string;
 *   id?: string;
 *   name?: string;
 *   widthClass?: string;
 * }} props
 */
const ImageUploadZone: React.FC<{
  preview: string | null;
  onPick?: (file: File, previewUrl: string) => void;
  onClear?: () => void;
  onUploaded?: (resp: UploadResponse) => void;
  uploadUrl: string;
  authToken?: string;
  disabled?: boolean;
  maxSizeMB?: number;
  accept?: string;
  className?: string;
  id?: string;
  name?: string;
  widthClass?: string;
}> = ({
  preview,
  onPick,
  onClear,
  onUploaded,
  uploadUrl,
  authToken,
  disabled = false,
  maxSizeMB = 20,
  accept = 'image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif',
  className = '',
  id,
  name,
  widthClass = 'w-56'
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(preview);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => setLocalPreview(preview), [preview]);

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

  const revokeUrl = (url?: string | null) => {
    if (url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
  };

  const uploadWithRetry = (file: File, maxRetries = 2): Promise<UploadResponse> =>
    new Promise((resolve, reject) => {
      let attempts = 0;
      const attempt = () => {
        attempts += 1;
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('POST', uploadUrl, true);
        if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) setProgress(Math.round((evt.loaded / evt.total) * 100));
        };
        xhr.onreadystatechange = () => {
          if (xhr.readyState !== 4) return;
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText) as UploadResponse;
              return resolve(data);
            } catch {
              return reject(new Error('Invalid server response'));
            }
          }
          if (attempts <= maxRetries) {
            const backoff = Math.min(2000 * attempts, 6000);
            setTimeout(attempt, backoff);
          } else {
            try {
              const msg = JSON.parse(xhr.responseText)?.error;
              reject(new Error(msg || 'Upload failed'));
            } catch {
              reject(new Error('Upload failed'));
            }
          }
        };
        xhr.onerror = () => {
          if (attempts <= maxRetries) {
            const backoff = Math.min(2000 * attempts, 6000);
            setTimeout(attempt, backoff);
          } else {
            reject(new Error('Network error'));
          }
        };
        const form = new FormData();
        form.append('file', file);
        xhr.send(form);
      };
      attempt();
    });

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const file = fileList[0];
    const msg = validate(file);
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    revokeUrl(localPreview);
    const blobUrl = URL.createObjectURL(file);
    setLocalPreview(blobUrl);
    setLastFile(file);
    onPick?.(file, blobUrl);
    setUploading(true);
    setProgress(1);
    uploadWithRetry(file)
      .then((resp) => {
        setProgress(100);
        onUploaded?.(resp);
        setTimeout(() => {
          setLocalPreview(resp.cdn.medium);
          revokeUrl(blobUrl);
        }, 100);
      })
      .catch((err) => {
        setError(err.message || 'Upload failed');
      })
      .finally(() => {
        setUploading(false);
        xhrRef.current = null;
      });
  };

  const retry = () => {
    if (!lastFile || disabled) return;
    setError(null);
    setUploading(true);
    setProgress(1);
    uploadWithRetry(lastFile)
      .then((resp) => {
        setProgress(100);
        onUploaded?.(resp);
        setTimeout(() => {
          setLocalPreview(resp.cdn.medium);
        }, 100);
      })
      .catch((err) => setError(err.message || 'Upload failed'))
      .finally(() => {
        setUploading(false);
        xhrRef.current = null;
      });
  };

  const cancelUpload = () => {
    try {
      xhrRef.current?.abort();
    } catch {}
    setUploading(false);
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
        <div
          className={[
            'relative rounded-lg border border-dashed',
            'border-[#dbdbdb]',
            dragOver ? 'bg-[#f3f4f6]' : 'bg-[#fcfcfc] hover:bg-[#f6f6f6]',
            'transition-colors'
          ].join(' ')}
        >
          <div className="pt-[100%]" />
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-describedby={errorId}
            onClick={() => (!disabled ? inputRef.current?.click() : undefined)}
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
                    inputRef.current?.click();
                  }}
                  disabled={disabled}
                  className="inline-flex items-center justify-center min-w-[100px] px-4 py-1.5 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f8f8f8] hover:border-[#bdbdbd] active:bg-[#eceff1] transition-colors text-sm text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#e5e7eb]"
                >
                  Browse
                </button>
              </div>

              {uploading && (
                <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center p-4">
                  <div className="w-4/5 bg-white/60 rounded-full h-2 overflow-hidden">
                    <div className="h-2 bg-[#111827] transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-white">{progress}%</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelUpload();
                    }}
                    className="mt-2 text-xs text-white underline"
                  >
                    Cancel
                  </button>
                </div>
              )}
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

      {localPreview && (
        <div className="mt-3 flex items-center gap-3">
          <img
            src={localPreview}
            alt="Selected preview"
            className="h-20 w-20 object-cover rounded-md border border-[#dbdbdb] bg-[#fcfcfc]"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                revokeUrl(localPreview);
                setLocalPreview(null);
                setError(null);
                setProgress(0);
                onClear?.();
              }}
              className="text-sm text-red-600 hover:underline"
            >
              Remove
            </button>
            {error && (
              <button type="button" onClick={retry} className="text-sm text-[#111827] hover:underline">
                Retry
              </button>
            )}
          </div>
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