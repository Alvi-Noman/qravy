import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';

type CdnUrls = { original: string; thumbnail: string; medium: string; large: string };
type UploadResponse = { ok: boolean; key: string; hash: string; mime: string; size: number; cdn: CdnUrls };

type Props = {
  previews: (string | null)[];
  onPick?: (index: number, file: File, previewUrl: string) => void;
  onUploaded?: (index: number, resp: UploadResponse) => void;
  onClear?: (index: number) => void;
  uploadUrl: string;
  authToken?: string;
  maxCount?: number;
  disabled?: boolean;
  maxSizeMB?: number;
  accept?: string;
  className?: string;
  id?: string;
  name?: string;
  primaryWidthClass?: string;
  thumbWidthClass?: string;
  gapPx?: number;
  readOnlyCount?: number;
};

const arraysEqual = (a: (string | null)[], b: (string | null)[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const isLoadingSentinel = (src: string | null) => !!src && src.startsWith('loading:');

const ImageUploadZone: React.FC<Props> = ({
  previews,
  onPick,
  onUploaded,
  onClear,
  uploadUrl,
  authToken,
  maxCount = 5,
  disabled = false,
  maxSizeMB = 20,
  accept = 'image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif',
  className = '',
  id,
  name,
  primaryWidthClass = 'w-56',
  thumbWidthClass = 'w-28',
  gapPx = 12,
  readOnlyCount = 0,
}) => {
  const normalizedFromProps = useMemo<(string | null)[]>(() => {
    const limited = (previews || []).slice(0, maxCount);
    return limited.length > 0 ? limited : [null];
  }, [previews, maxCount]);

  const [localPreviews, setLocalPreviews] = useState<(string | null)[]>(normalizedFromProps);

  useEffect(() => {
    setLocalPreviews((prev) => (arraysEqual(prev, normalizedFromProps) ? prev : normalizedFromProps));
  }, [normalizedFromProps]);

  const [uploading, setUploading] = useState<boolean[]>([]);
  const [progress, setProgress] = useState<number[]>([]);
  const [errors, setErrors] = useState<(string | null)[]>([]);
  const [dragOver, setDragOver] = useState<boolean[]>([]);
  const lastFileRef = useRef<(File | null)[]>([]);
  const xhrRef = useRef<(XMLHttpRequest | null)[]>([]);
  const clickTsRef = useRef<number[]>([]);

  const primaryRef = useRef<HTMLDivElement | null>(null);
  const [primaryPx, setPrimaryPx] = useState<number>(224);
  useEffect(() => {
    const el = primaryRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && w > 0) setPrimaryPx((prev) => (prev === Math.floor(w) ? prev : Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const thumbPx = Math.floor((primaryPx - gapPx) / 2);
  const thumbSizeStyle: React.CSSProperties = { width: `${thumbPx}px`, height: `${thumbPx}px` };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const isReadOnly = (i: number) => i < readOnlyCount || isLoadingSentinel(localPreviews[i] || null);

  const ensureIndex = (i: number) => {
    const growTo = i + 1;
    setUploading((prev) => {
      const next = prev.slice(0, growTo);
      while (next.length < growTo) next.push(false);
      return next;
    });
    setProgress((prev) => {
      const next = prev.slice(0, growTo);
      while (next.length < growTo) next.push(0);
      return next;
    });
    setErrors((prev) => {
      const next = prev.slice(0, growTo);
      while (next.length < growTo) next.push(null);
      return next;
    });
    setDragOver((prev) => {
      const next = prev.slice(0, growTo);
      while (next.length < growTo) next.push(false);
      return next;
    });
    while (lastFileRef.current.length < growTo) lastFileRef.current.push(null);
    while (xhrRef.current.length < growTo) xhrRef.current.push(null);
    while (clickTsRef.current.length < growTo) clickTsRef.current.push(0);
  };

  const openDialogFor = (i: number) => {
    if (disabled || isReadOnly(i)) return;
    ensureIndex(i);
    const now = Date.now();
    const last = clickTsRef.current[i] || 0;
    if (now - last < 600) return;
    if (uploading[i] || xhrRef.current[i]) return;
    clickTsRef.current[i] = now;
    setActiveIndex(i);
    fileInputRef.current?.click();
  };

  const handleKey = (i: number, e: React.KeyboardEvent) => {
    if (!disabled && !isReadOnly(i) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openDialogFor(i);
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
    if (!url || !url.startsWith('blob:')) return;
    requestAnimationFrame(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    });
  };

  const setUploadingAt = (i: number, val: boolean) =>
    setUploading((prev) => {
      const n = prev.slice();
      n[i] = val;
      return n;
    });
  const setProgressAt = (i: number, val: number) =>
    setProgress((prev) => {
      const n = prev.slice();
      n[i] = val;
      return n;
    });
  const setErrorAt = (i: number, val: string | null) =>
    setErrors((prev) => {
      const n = prev.slice();
      n[i] = val;
      return n;
    });
  const setDragOverAt = (i: number, val: boolean) =>
    setDragOver((prev) => {
      const n = prev.slice();
      n[i] = val;
      return n;
    });

  const setPreviewAt = (i: number, val: string | null) =>
    setLocalPreviews((prev) => {
      const next = prev.slice();
      if (i === prev.length) next.push(val);
      else next[i] = val;
      return next;
    });

  const removeAt = (i: number) => {
    if (isReadOnly(i)) return;
    try {
      xhrRef.current[i]?.abort();
    } catch {}
    xhrRef.current[i] = null;
    revokeUrl(localPreviews[i]);
    setLocalPreviews((prev) => {
      const next = prev.slice();
      next.splice(i, 1);
      return next.length > 0 ? next : [null];
    });
    setUploading((prev) => {
      const n = prev.slice();
      n.splice(i, 1);
      return n;
    });
    setProgress((prev) => {
      const n = prev.slice();
      n.splice(i, 1);
      return n;
    });
    setErrors((prev) => {
      const n = prev.slice();
      n.splice(i, 1);
      return n;
    });
    setDragOver((prev) => {
      const n = prev.slice();
      n.splice(i, 1);
      return n;
    });
    lastFileRef.current.splice(i, 1);
    clickTsRef.current.splice(i, 1);
    onClear?.(i);
  };

  const uploadWithRetry = (i: number, file: File, maxRetries = 2): Promise<UploadResponse> =>
    new Promise((resolve, reject) => {
      let attempts = 0;
      const attempt = () => {
        attempts += 1;
        const xhr = new XMLHttpRequest();
        xhrRef.current[i] = xhr;
        xhr.open('POST', uploadUrl, true);
        if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) setProgressAt(i, Math.round((evt.loaded / evt.total) * 100));
        };
        xhr.onreadystatechange = () => {
          if (xhr.readyState !== 4) return;
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText) as UploadResponse;
              resolve(data);
            } catch {
              reject(new Error('Invalid server response'));
            }
            return;
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

  const handleFilesFor = (i: number, fileList: FileList | null) => {
    if (isReadOnly(i)) return;
    if (!fileList?.length) return;
    if (uploading[i] || xhrRef.current[i]) return;
    const file = fileList[0];
    ensureIndex(i);
    const msg = validate(file);
    if (msg) {
      setErrorAt(i, msg);
      return;
    }
    setErrorAt(i, null);
    const prevUrl = localPreviews[i];
    revokeUrl(prevUrl);
    const blobUrl = URL.createObjectURL(file);
    setPreviewAt(i, blobUrl);
    lastFileRef.current[i] = file;
    onPick?.(i, file, blobUrl);
    setUploadingAt(i, true);
    setProgressAt(i, 1);
    uploadWithRetry(i, file)
      .then((resp) => {
        setProgressAt(i, 100);
        onUploaded?.(i, resp);
        setTimeout(() => {
          setPreviewAt(i, resp.cdn.medium);
          revokeUrl(blobUrl);
        }, 100);
      })
      .catch((err) => setErrorAt(i, err.message || 'Upload failed'))
      .finally(() => {
        setUploadingAt(i, false);
        xhrRef.current[i] = null;
        clickTsRef.current[i] = Date.now();
      });
  };

  const retry = (i: number) => {
    if (isReadOnly(i)) return;
    const last = lastFileRef.current[i];
    if (!last || disabled) return;
    if (uploading[i] || xhrRef.current[i]) return;
    setErrorAt(i, null);
    setUploadingAt(i, true);
    setProgressAt(i, 1);
    uploadWithRetry(i, last)
      .then((resp) => {
        setProgressAt(i, 100);
        onUploaded?.(i, resp);
        setTimeout(() => setPreviewAt(i, resp.cdn.medium), 100);
      })
      .catch((err) => setErrorAt(i, err.message || 'Upload failed'))
      .finally(() => {
        setUploadingAt(i, false);
        xhrRef.current[i] = null;
        clickTsRef.current[i] = Date.now();
      });
  };

  const cancelUpload = (i: number) => {
    if (isReadOnly(i)) return;
    try {
      xhrRef.current[i]?.abort();
    } catch {}
    xhrRef.current[i] = null;
    setUploadingAt(i, false);
  };

  const onDrop = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReadOnly(i)) return;
    setDragOverAt(i, false);
    if (!disabled && !uploading[i] && !xhrRef.current[i]) handleFilesFor(i, e.dataTransfer.files);
  };
  const onDragOver = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isReadOnly(i)) setDragOverAt(i, true);
  };
  const onDragLeave = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isReadOnly(i)) setDragOverAt(i, false);
  };

  const hasPrimary = localPreviews[0] !== null && !isLoadingSentinel(localPreviews[0]);

  function renderPrimary(i: number) {
    const readOnly = isReadOnly(i);
    const loadingExternal = isLoadingSentinel(localPreviews[i]);
    const hasImage = localPreviews[i] !== null && !loadingExternal;
    const errorId = errors[i] ? `image-zone-error-${i}` : undefined;
    return (
      <div key={`tile-${i}`} ref={primaryRef} className={`relative flex-none ${primaryWidthClass} self-start`}>
        <div
          className={[
            'relative rounded-lg border',
            hasImage ? 'border-[#dbdbdb]' : 'border-dashed border-[#dbdbdb]',
            dragOver[i] ? 'bg-[#f3f4f6]' : 'bg-[#fcfcfc] hover:bg-[#f6f6f6]',
            'transition-colors',
          ].join(' ')}
        >
          <div className="pt-[100%]" />
          {hasImage && (
            <img src={localPreviews[i] || ''} alt="Primary image" className="absolute inset-0 h-full w-full object-cover rounded-lg" />
          )}
          <div
            role="button"
            tabIndex={disabled || readOnly ? -1 : 0}
            aria-disabled={disabled || readOnly}
            aria-describedby={errorId}
            onClick={() => openDialogFor(i)}
            onKeyDown={(e) => handleKey(i, e)}
            onDrop={(e) => onDrop(i, e)}
            onDragOver={(e) => onDragOver(i, e)}
            onDragLeave={(e) => onDragLeave(i, e)}
            className={`absolute inset-0 ${disabled || readOnly ? 'cursor-default' : 'cursor-pointer'}`}
          >
            {!hasImage && !loadingExternal && (
              <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
                <div className="flex flex-col items-center pointer-events-none select-none">
                  <CloudArrowUpIcon className="h-7 w-7 text-[#6b7280]" aria-hidden="true" />
                  <div className="mt-2 text-sm font-medium text-[#2e2e30]">Drag your Image Here</div>
                  <div className="my-1 text-xs text-[#a9a9ab]">or</div>
                  {!readOnly && (
                    <div className="pointer-events-auto">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDialogFor(i);
                        }}
                        disabled={disabled || uploading[i] || !!xhrRef.current[i]}
                        className="inline-flex items-center justify-center min-w-[100px] px-4 py-1.5 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f8f8f8] hover:border-[#bdbdbd] active:bg-[#eceff1] transition-colors text-sm text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#e5e7eb]"
                      >
                        Browse
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(uploading[i] || loadingExternal) && (
              <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center p-4">
                {loadingExternal ? (
                  <>
                    <div className="h-6 w-6 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                    <div className="mt-2 text-xs text-white">Uploading...</div>
                  </>
                ) : (
                  <>
                    <div className="w-4/5 bg-white/60 rounded-full h-2 overflow-hidden">
                      <div className="h-2 bg-[#111827] transition-all" style={{ width: `${progress[i]}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-white">{progress[i]}%</div>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelUpload(i);
                        }}
                        className="mt-2 text-xs text-white underline"
                      >
                        Cancel
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {hasImage && !uploading[i] && !readOnly && (
              <div className="absolute top-1 right-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  className="px-2 py-1 rounded bg-white/85 backdrop-blur text-xs text-[#111827] border border-[#dbdbdb] hover:bg-white"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
        {errors[i] && (
          <p id={errorId} className="mt-2 text-sm text-red-600" role="alert" aria-live="polite">
            {errors[i]} {!isReadOnly(i) && <button className="underline ml-2" onClick={() => retry(i)}>Retry</button>}
          </p>
        )}
      </div>
    );
  }

  function renderThumb(i: number) {
    const readOnly = isReadOnly(i);
    const loadingExternal = isLoadingSentinel(localPreviews[i]);
    const hasImage = localPreviews[i] !== null && !loadingExternal;
    const errorId = errors[i] ? `image-zone-error-${i}` : undefined;
    return (
      <div key={`tile-${i}`} className="relative flex-none self-start" style={thumbSizeStyle}>
        <div
          className={[
            'relative h-full w-full rounded-md border',
            hasImage ? 'border-[#dbdbdb]' : 'border-dashed border-[#dbdbdb]',
            dragOver[i] ? 'bg-[#f3f4f6]' : 'bg-[#fcfcfc] hover:bg-[#f6f6f6]',
            'transition-colors',
          ].join(' ')}
        >
          {hasImage && (
            <img src={localPreviews[i] || ''} alt={`Media ${i}`} className="absolute inset-0 h-full w-full object-cover rounded-md" />
          )}
          <div
            role="button"
            tabIndex={disabled || readOnly ? -1 : 0}
            aria-disabled={disabled || readOnly}
            aria-describedby={errorId}
            onClick={() => openDialogFor(i)}
            onKeyDown={(e) => handleKey(i, e)}
            onDrop={(e) => onDrop(i, e)}
            onDragOver={(e) => onDragOver(i, e)}
            onDragLeave={(e) => onDragLeave(i, e)}
            className={`absolute inset-0 ${disabled || readOnly ? 'cursor-default' : 'cursor-pointer'}`}
          >
            {(uploading[i] || loadingExternal) && (
              <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center p-4">
                {loadingExternal ? (
                  <>
                    <div className="h-6 w-6 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                    <div className="mt-2 text-xs text-white">Uploading...</div>
                  </>
                ) : (
                  <>
                    <div className="w-4/5 bg-white/60 rounded-full h-2 overflow-hidden">
                      <div className="h-2 bg-[#111827] transition-all" style={{ width: `${progress[i]}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-white">{progress[i]}%</div>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelUpload(i);
                        }}
                        className="mt-2 text-xs text-white underline"
                      >
                        Cancel
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {hasImage && !uploading[i] && !readOnly && (
              <div className="absolute top-1 right-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  className="px-2 py-1 rounded bg-white/85 backdrop-blur text-xs text-[#111827] border border-[#dbdbdb] hover:bg-white"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>

        {errors[i] && (
          <p id={errorId} className="mt-2 text-sm text-red-600" role="alert" aria-live="polite">
            {errors[i]} {!isReadOnly(i) && <button className="underline ml-2" onClick={() => retry(i)}>Retry</button>}
          </p>
        )}
      </div>
    );
  }

  function renderAddTile(i: number) {
    return (
      <button
        key="add-tile"
        type="button"
        onClick={() => openDialogFor(i)}
        disabled={disabled}
        aria-label="Add image"
        className={`relative flex-none self-start rounded-md border border-dashed border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f6f6f6] transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
        style={thumbSizeStyle}
        onDrop={(e) => onDrop(i, e)}
        onDragOver={(e) => onDragOver(i, e)}
        onDragLeave={(e) => onDragLeave(i, e)}
      >
        <span className="absolute inset-0 flex items-center justify-center text-3xl leading-none text-[#6b7280]">+</span>
      </button>
    );
  }

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-start gap-4">
        {renderPrimary(0)}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start content-start gap-3" style={{ height: `${primaryPx}px` }}>
            {localPreviews.slice(1).map((_, idx) => renderThumb(idx + 1))}
            {hasPrimary && localPreviews.length < maxCount && renderAddTile(localPreviews.length)}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        id={id}
        name={name}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const input = e.currentTarget as HTMLInputElement;
          handleFilesFor(activeIndex, input.files);
          input.value = '';
        }}
      />
    </div>
  );
};

export default ImageUploadZone;