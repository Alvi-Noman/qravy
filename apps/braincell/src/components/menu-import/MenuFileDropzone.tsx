import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsUpDownIcon,
  CameraIcon,
  DocumentArrowUpIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const MAX_PDF_MB = 50;
const MAX_PHOTO_MB = 20;
export const MAX_PHOTOS = 10;

const ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isHeic = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
const isPhoto = (f: File) => /^image\/(jpeg|png|webp)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);

/** iPhone photos: convert HEIC → JPEG in the browser (the server can't decode HEIC). */
async function toJpegIfHeic(f: File): Promise<File> {
  if (!isHeic(f)) return f;
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.9 });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], f.name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' });
}

type Photo = { id: string; file: File; url: string };
let seq = 0;

/** Grid tile that can be picked up: hold (touch) or drag (mouse); arrows for keyboard/precise moves. */
function SortablePhotoTile(props: {
  photo: Photo;
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: props.photo.id,
  });
  return (
    <PhotoTile
      {...props}
      isDragging={isDragging}
      liProps={{
        ref: setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
        ...attributes,
        ...listeners,
      }}
    />
  );
}

/** Photo thumbnail card (also used, lifted, in the drag overlay). */
function PhotoTile({
  photo,
  index,
  total,
  onMove,
  onRemove,
  lifted = false,
  isDragging = false,
  liProps,
}: {
  photo: Photo;
  index: number;
  total: number;
  onMove?: (dir: -1 | 1) => void;
  onRemove?: () => void;
  /** Rendered in the drag overlay (follows the finger) */
  lifted?: boolean;
  isDragging?: boolean;
  liProps?: React.HTMLAttributes<HTMLLIElement> & { ref?: (el: HTMLElement | null) => void };
}) {
  return (
    <li
      {...liProps}
      aria-roledescription="sortable photo"
      aria-label={`Page ${index + 1}: ${photo.file.name}. Hold and drag to move.`}
      className={`list-none select-none overflow-hidden rounded-lg border bg-white outline-none focus-visible:ring-2 focus-visible:ring-[#2e2e30] [-webkit-touch-callout:none] [touch-action:manipulation] ${
        lifted
          ? 'rotate-2 scale-105 cursor-grabbing border-[#2e2e30] shadow-xl'
          : isDragging
            ? 'border-dashed border-[#9a9aa0] opacity-40'
            : 'cursor-grab border-[#e5e5e5] active:cursor-grabbing'
      }`}
    >
      <div className="relative aspect-[3/4] bg-[#f3f3f3]">
        <img src={photo.url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
          {index + 1}
        </span>
        {!lifted && onRemove && (
          <button
            type="button"
            aria-label={`Remove photo ${index + 1}`}
            onClick={onRemove}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-[#2e2e30] hover:bg-white"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          type="button"
          aria-label="Move earlier"
          disabled={lifted || index === 0}
          onClick={() => onMove?.(-1)}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="rounded p-1 text-[#6b6b70] hover:bg-[#f0f0f0] disabled:opacity-30"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <span className="truncate px-1 text-xs text-[#9a9aa0]">{photo.file.name}</span>
        <button
          type="button"
          aria-label="Move later"
          disabled={lifted || index === total - 1}
          onClick={() => onMove?.(1)}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="rounded p-1 text-[#6b6b70] hover:bg-[#f0f0f0] disabled:opacity-30"
        >
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

/**
 * Menu upload: one PDF (starts right away) or up to 10 photos, which the owner
 * can put in page order before sending.
 */
export default function MenuFileDropzone({
  onSubmit,
  disabled,
  initialFiles,
}: {
  onSubmit: (files: File[]) => void;
  disabled?: boolean;
  /** Photos picked elsewhere (Dashboard) — shown for ordering before upload */
  initialFiles?: File[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);

  // Free preview URLs
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  useEffect(() => {
    if (initialFiles?.length) void pick(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);

    const pdfs = files.filter(isPdf);
    if (pdfs.length) {
      if (files.length > 1 || photos.length) {
        return setError('Upload one PDF on its own, or photos without a PDF.');
      }
      if (pdfs[0].size > MAX_PDF_MB * 1024 * 1024) return setError(`PDF is too large (max ${MAX_PDF_MB} MB).`);
      return onSubmit([pdfs[0]]);
    }

    const bad = files.find((f) => !isPhoto(f) && !isHeic(f));
    if (bad) return setError(`"${bad.name}" isn’t supported. Use a PDF, JPG, PNG, WebP or iPhone photo.`);
    if (photos.length + files.length > MAX_PHOTOS) {
      return setError(`You can add up to ${MAX_PHOTOS} photos. For longer menus, use a PDF.`);
    }

    setConverting(files.some(isHeic));
    try {
      const ready: Photo[] = [];
      for (const f of files) {
        const jpg = await toJpegIfHeic(f);
        if (jpg.size > MAX_PHOTO_MB * 1024 * 1024) {
          setError(`"${f.name}" is too large (max ${MAX_PHOTO_MB} MB per photo).`);
          continue;
        }
        ready.push({ id: `p${seq++}`, file: jpg, url: URL.createObjectURL(jpg) });
      }
      setPhotos((cur) => [...cur, ...ready]);
    } catch {
      setError('One of the iPhone photos could not be converted. Try exporting it as JPG.');
    } finally {
      setConverting(false);
    }
  };

  const move = (i: number, dir: -1 | 1) =>
    setPhotos((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (id: string) =>
    setPhotos((cur) => {
      const p = cur.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return cur.filter((x) => x.id !== id);
    });

  // Mouse: drag after moving 5px. Touch: press and hold ~200ms, then move (so the page still scrolls).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const onDragStart = (e: DragStartEvent) => {
    setDraggingId(String(e.active.id));
    try {
      navigator.vibrate?.(15); // haptic "picked up" on phones
    } catch {}
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPhotos((cur) => {
      const from = cur.findIndex((x) => x.id === active.id);
      const to = cur.findIndex((x) => x.id === over.id);
      return from < 0 || to < 0 ? cur : arrayMove(cur, from, to);
    });
  };

  const draggingIndex = draggingId ? photos.findIndex((x) => x.id === draggingId) : -1;

  return (
    <div>
      <button
        type="button"
        disabled={disabled || converting}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) void pick(e.dataTransfer.files);
        }}
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 text-center transition-colors ${
          photos.length ? 'py-6' : 'py-14'
        } ${over ? 'border-[#2e2e30] bg-[#f3f3f3]' : 'border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f6f6f6]'} ${
          disabled || converting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        }`}
      >
        <div className="mb-3 flex items-center gap-2 text-slate-500">
          <DocumentArrowUpIcon className="h-9 w-9" />
          <CameraIcon className="h-9 w-9" />
        </div>
        <span className="text-base font-semibold text-[#2e2e30]">
          {converting
            ? 'Preparing iPhone photos…'
            : photos.length
              ? 'Add more photos'
              : 'Drop your menu PDF or photos here'}
        </span>
        <span className="mt-1 text-sm text-[#6b6b70]">
          or click to browse · one PDF (up to {MAX_PDF_MB} MB) or up to {MAX_PHOTOS} photos (JPG, PNG, iPhone)
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files);
          e.target.value = '';
        }}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {photos.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm text-[#6b6b70]">
              Put the photos in page order — the first photo is page 1. Hold a photo and drag it to move it.
            </p>
            {photos.length > 1 && (
              <button
                type="button"
                onClick={() => setPhotos((cur) => [...cur].reverse())}
                title="Last photo becomes page 1 (useful when your gallery lists newest first)"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#dbdbdb] bg-white px-3 py-1.5 text-sm text-[#2e2e30] hover:bg-[#f6f6f6]"
              >
                <ArrowsUpDownIcon className="h-4 w-4" /> Reverse order
              </button>
            )}
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDraggingId(null)}
          >
            <SortableContext items={photos.map((x) => x.id)} strategy={rectSortingStrategy}>
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {photos.map((photo, i) => (
                  <SortablePhotoTile
                    key={photo.id}
                    photo={photo}
                    index={i}
                    total={photos.length}
                    onMove={(dir) => move(i, dir)}
                    onRemove={() => remove(photo.id)}
                  />
                ))}
              </ol>
            </SortableContext>
            <DragOverlay>
              {draggingIndex >= 0 ? (
                <PhotoTile photo={photos[draggingIndex]} index={draggingIndex} total={photos.length} lifted />
              ) : null}
            </DragOverlay>
          </DndContext>
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                photos.forEach((p) => URL.revokeObjectURL(p.url));
                setPhotos([]);
              }}
              className="text-sm text-[#6b6b70] underline-offset-2 hover:text-[#2e2e30] hover:underline"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={disabled || converting}
              onClick={() => onSubmit(photos.map((p) => p.file))}
              className="rounded-md bg-[#2e2e30] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Read menu ({photos.length} photo{photos.length === 1 ? '' : 's'})
            </button>
          </div>
        </div>
      )}

      <details className="mt-4 text-sm text-[#6b6b70]">
        <summary className="cursor-pointer select-none">Tips for menu photos</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>One page per photo, taken straight on — lay the menu flat.</li>
          <li>Good light, no flash glare, and make sure prices are in focus.</li>
          <li>Fill the frame with the menu; the table around it is ignored.</li>
          <li>For wall menu boards, one photo of the whole board works — we zoom in automatically.</li>
        </ul>
      </details>
    </div>
  );
}
