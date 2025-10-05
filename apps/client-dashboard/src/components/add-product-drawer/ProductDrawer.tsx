import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../../context/AuthContext';
import CategorySelect from './CategorySelect';
import { createCategory as apiCreateCategory, type Category } from '../../api/categories';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import Variations from './Variations';
import ImageUploadZone from './ImageUploadZone';
import Tags from './Tags';
import type { TenantDTO } from '../../../../../packages/shared/src/types/v1';
import { useScope } from '../../context/ScopeContext';
import { fetchLocations, type Location } from '../../api/locations';

type UiVariation = { label: string; price?: string; imagePreview?: string | null; imageUrl?: string | null };

const safeRevoke = (url?: string | null) => {
  if (!url || !url.startsWith('blob:')) return;
  requestAnimationFrame(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
};

const deepEqual = (a: unknown, b: unknown) => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

// NEW: minimum visual saving duration + helpers
const MIN_SAVE_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isPromise = (v: any): v is Promise<unknown> => v && typeof v.then === 'function';

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
    // Advanced selections (optional)
    channel?: 'dine-in' | 'online';
    includeLocationIds?: string[];
    excludeLocationIds?: string[];
  }) => void | Promise<void>; // allow async submit
  persistKey?: string;
}) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const { token } = useAuthContext();
  const { activeLocationId, channel: scopeChannel } = useScope();
  const queryClient = useQueryClient();

  const STORAGE_TTL_MS = 5_000;
  const MAX_MEDIA = 5;
  const storageKey = useMemo(() => `pdraft:${persistKey || 'add'}`, [persistKey]);

  const initPreviews = (() => {
    const list = Array.isArray(initial.imagePreviews) ? initial.imagePreviews.slice(0, MAX_MEDIA) : [];
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
    (initial.imagePreviews || []).map((u) => (u && !u.startsWith('blob:') ? u : '')).slice(0, MAX_MEDIA)
  );
  const [tags, setTags] = useState<string[]>(initial.tags || []);
  const [uiVariations, setUiVariations] = useState<UiVariation[]>(initial.variations || []);

  // Advanced: UI state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Channels default from ScopeContext channel
  const [chDineIn, setChDineIn] = useState(scopeChannel !== 'online'); // default true unless scope is online
  const [chOnline, setChOnline] = useState(scopeChannel !== 'dine-in'); // default true unless scope is dine-in
  // Branch checklist (for All locations only)
  const locationsQuery = useQuery<Location[]>({
    queryKey: ['locations', token],
    queryFn: fetchLocations,
    enabled: !!token && !activeLocationId, // we only need when All locations is selected
    staleTime: 30_000,
  });
  const allLocations = locationsQuery.data ?? [];
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());

  // Initialize branch selection to "all checked" when data arrives (All locations view only)
  useEffect(() => {
    if (activeLocationId) return; // branch scope
    if (allLocations.length && selectedBranchIds.size === 0) {
      setSelectedBranchIds(new Set(allLocations.map((l) => l.id)));
    }
  }, [allLocations, selectedBranchIds.size, activeLocationId]);

  // Global errors
  const [localError, setLocalError] = useState<string | null>(null);
  const [varNameError, setVarNameError] = useState<string | null>(null);
  const [varImageError, setVarImageError] = useState<string | null>(null);
  const [mediaImageError, setMediaImageError] = useState<string | null>(null);

  // Field-level errors (for inline highlight)
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const [compareAtErr, setCompareAtErr] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [localCats, setLocalCats] = useState<string[]>(categories);
  useEffect(() => setLocalCats(categories), [categories]);

  // Trigger to make Variations highlight invalid prices on submit click
  const [varPriceValidateTick, setVarPriceValidateTick] = useState(0);

  const createCatMut = useMutation<Category, Error, string>({
    mutationFn: async (name: string) => {
      if (!token) throw new Error('Not authenticated');
      return await apiCreateCategory(name, token);
    },
    onSuccess: (cat) => {
      setLocalCats((prev) => (prev.includes(cat.name) ? prev : [...prev, cat.name]));
      try {
        queryClient.invalidateQueries({ queryKey: ['categories'] });
      } catch {}
      try {
        if (token) {
          queryClient.setQueryData(['tenant', token], (prev: TenantDTO | undefined) =>
            prev
              ? {
                  ...prev,
                  onboardingProgress: {
                    ...(prev.onboardingProgress ?? {}),
                    hasCategory: true,
                  },
                }
              : prev
          );
          queryClient.invalidateQueries({ queryKey: ['tenant', token] });
        }
      } catch {}
    },
  });

  // Restore snapshot (narrow arrays before setting to satisfy TS and avoid loops)
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

      if (snap.values) {
        const sv = snap.values;
        const { imageFiles: _discard, ...svRest } = sv as any;
        setValues((prev) => {
          const merged = {
            ...prev,
            ...svRest,
            imagePreviews: Array.isArray(sv.imagePreviews) ? sv.imagePreviews : prev.imagePreviews,
          };
          return deepEqual(prev, merged) ? prev : merged;
        });
      }

      if (Array.isArray(snap.tags)) {
        const newTags: string[] = snap.tags;
        setTags((prev) => (deepEqual(prev, newTags) ? prev : newTags));
      }

      if (Array.isArray(snap.uiVariations)) {
        const newVars: UiVariation[] = snap.uiVariations;
        setUiVariations((prev) => (deepEqual(prev, newVars) ? prev : newVars));
      }

      if (Array.isArray(snap.remoteUrls)) {
        const newRemote: string[] = snap.remoteUrls;
        setRemoteUrls((prev) => (deepEqual(prev, newRemote) ? prev : newRemote));
      }
    } catch {}
  }, [storageKey]);

  const previewsRef = useRef<(string | null)[]>(values.imagePreviews);
  useEffect(() => {
    previewsRef.current = values.imagePreviews;
  }, [values.imagePreviews]);
  useEffect(() => {
    return () => {
      try {
        previewsRef.current?.forEach((u) => safeRevoke(u));
      } catch {}
    };
  }, []);

  const typedVariants = useMemo(
    () => (uiVariations || []).filter((v) => v.label.trim() !== ''),
    [uiVariations]
  );

  // Resolved (non-blob) variant URLs (for dedupe and base filtering)
  const variantUrls = useMemo(() => {
    const items: string[] = [];
    typedVariants.forEach((v) => {
      const url = v.imageUrl || (v.imagePreview && !v.imagePreview.startsWith('blob:') ? v.imagePreview : null);
      if (url) items.push(url);
    });
    return items;
  }, [typedVariants]);

  // Variant tiles for Media grid: include CDN URLs, and include uploading blobs as "loading:" sentinels
  const variantTiles = useMemo(() => {
    return (
      typedVariants
        .map((v) => {
          const cdn = v.imageUrl || (v.imagePreview && !v.imagePreview.startsWith('blob:') ? v.imagePreview : null);
          if (cdn) return cdn;
          const blob = v.imagePreview && v.imagePreview.startsWith('blob:') ? v.imagePreview : null;
          return blob ? `loading:${blob}` : null;
        })
        .filter(Boolean) as string[]
    );
  }, [typedVariants]);

  // Base gallery images (excluding those used by resolved variant URLs)
  const galleryBase = useMemo(() => {
    const base = (values.imagePreviews || []).filter((u) => u !== null) as string[];
    const seen = new Set(variantUrls);
    return base.filter((u) => !seen.has(u));
  }, [values.imagePreviews, variantUrls]);

  // ORDER: [all variant tiles (including loading: sentinels)] + [all base images]
  const galleryPreviews = useMemo(() => {
    const merged = [...variantTiles, ...galleryBase];
    return merged.length === 0 ? [null] : merged;
  }, [variantTiles, galleryBase]);

  // Non-blob URLs currently shown in Media (Upload Zone), excluding variation images
  const mediaUrls = useMemo(
    () => galleryBase.filter((u): u is string => !!u && !u.startsWith('blob:')),
    [galleryBase]
  );

  const toNumber = (v: string) => Number(v);
  const priceNum = toNumber(values.price);
  const compareAtNum = values.compareAtPrice ? Number(values.compareAtPrice) : undefined;

  // If any variations exist, main price is informational (disabled)
  const hasAnyVariants = typedVariants.length > 0;
  const allowMainPrice = !hasAnyVariants;

  const hasMainPrice = Number.isFinite(priceNum) && priceNum > 0;

  // Keep Save enabled (only disable during saving or category creation)
  const isSaveDisabled = createCatMut.isPending || saving;

  function saveSnapshot() {
    try {
      const scrubBlob = (u: string | null) => (u && u.startsWith('blob:') ? null : u);

      // Only store stable URLs; remove File refs
      const { imageFiles: _drop, ...restValues } = values;
      const snapValues = {
        ...restValues,
        imagePreviews: (values.imagePreviews || []).map((u) => scrubBlob(u || null)),
      };

      const scrubVar = (v: UiVariation): UiVariation => {
        const finalUrl = v.imageUrl || (v.imagePreview && !v.imagePreview.startsWith('blob:') ? v.imagePreview : null);
        return {
          label: v.label,
          price: v.price,
          imagePreview: finalUrl,
          imageUrl: finalUrl,
        };
      };

      const snap = {
        t: Date.now(),
        ttl: STORAGE_TTL_MS,
        values: snapValues,
        tags,
        uiVariations: (uiVariations || []).map(scrubVar),
        remoteUrls,
      };
      sessionStorage.setItem(storageKey, JSON.stringify(snap));
    } catch {}
  }

  function clearSnapshot() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }

  // ========== Auto-scroll to first error ==========
  const scrollRef = useRef<HTMLFormElement | HTMLDivElement | null>(null);
  const errorSelector = '[role="alert"], [aria-invalid="true"]';

  const scrollErrorIntoView = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const firstErr = container.querySelector(errorSelector) as HTMLElement | null;
    if (!firstErr) return;

    const focusTarget =
      (firstErr.matches('input,textarea,select')
        ? firstErr
        : firstErr.querySelector('input,textarea,select')) as HTMLElement | null;
    try {
      focusTarget?.focus?.({ preventScroll: true } as any);
    } catch {}

    const cRect = container.getBoundingClientRect();
    const eRect = firstErr.getBoundingClientRect();

    const TOP_BUFFER = 96;
    const BOTTOM_BUFFER = 24;

    const isAbove = eRect.top < cRect.top + TOP_BUFFER;
    const isBelow = eRect.bottom > cRect.bottom - BOTTOM_BUFFER;

    if (isAbove || isBelow) {
      const targetTop = eRect.top - cRect.top - TOP_BUFFER;
      const delta = isAbove ? targetTop : eRect.bottom - cRect.bottom + BOTTOM_BUFFER;
      container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior: 'smooth' });
    }
  }, []);

  const scheduleScrollToError = useCallback(() => {
    requestAnimationFrame(() => setTimeout(scrollErrorIntoView, 0));
  }, [scrollErrorIntoView]);

  // Observe dynamic error changes inside the drawer (e.g., Variations row errors)
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        scrollErrorIntoView();
      });
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of Array.from(m.addedNodes)) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches(errorSelector) || node.querySelector?.(errorSelector)) {
              schedule();
              return;
            }
          }
        } else if (m.type === 'attributes') {
          const t = m.target as HTMLElement;
          if (t.matches(errorSelector)) {
            schedule();
            return;
          }
        }
      }
    });

    // Only observe aria-invalid changes (not class)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-invalid'],
    });

    return () => observer.disconnect();
  }, [errorSelector, scrollErrorIntoView]);

  // Inline validators
  const validateBeforeSubmit = (): boolean => {
    let hasError = false;
    setLocalError(null);

    // Name
    if (!values.name.trim()) {
      setNameErr('Name is required.');
      hasError = true;
    } else {
      setNameErr(null);
    }

    // Pricing
    if (hasAnyVariants) {
      // Invalid if empty or non-numeric
      const invalid = typedVariants.some((v) => {
        const s = (v.price ?? '').trim();
        if (s === '') return true;
        const n = Number(s);
        return !Number.isFinite(n);
      });

      // Trigger row validations in Variations (shows "Enter a number")
      setVarPriceValidateTick((t) => t + 1);
      if (invalid) hasError = true;

      // No main price validation needed
      setPriceErr(null);
      setCompareAtErr(null);
    } else {
      // Require product price
      if (!values.price || !Number.isFinite(priceNum) || priceNum <= 0) {
        setPriceErr('Enter a product price.');
        hasError = true;
      } else {
        setPriceErr(null);
      }

      // Compare-at must be valid and ≥ price (if present)
      if ((values.compareAtPrice ?? '').trim() !== '') {
        if (Number.isNaN(compareAtNum as number)) {
          setCompareAtErr('Enter a valid number.');
          hasError = true;
        } else if ((compareAtNum as number) < priceNum) {
          setCompareAtErr('Compare-at price must be ≥ product price.');
          hasError = true;
        } else {
          setCompareAtErr(null);
        }
      } else {
        setCompareAtErr(null);
      }
    }

    // Advanced validations
    const channelsUnchecked = !chDineIn && !chOnline;
    if (channelsUnchecked) {
      setLocalError('Select at least one channel (Dine-In or Online) in Advanced.');
      hasError = true;
    }

    if (!activeLocationId) {
      // All locations: ensure at least one branch selected
      if (allLocations.length && selectedBranchIds.size === 0) {
        setLocalError('Select at least one branch in Advanced.');
        hasError = true;
      }
    }

    // Block submit when we already have known variation/global issues
    if (varNameError || varImageError || mediaImageError) hasError = true;

    return !hasError;
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    if (saving) return;

    const ok = validateBeforeSubmit();
    if (!ok) {
      scheduleScrollToError();
      return;
    }

    const media: string[] = [];
    galleryPreviews.forEach((u) => {
      if (u && !u.startsWith('blob:') && !u.startsWith('loading:')) media.push(u);
    });

    const variations =
      typedVariants
        .map((v) => {
          const p = v.price ? Number(v.price) : undefined;
          const imageUrl =
            v.imageUrl || (v.imagePreview && !v.imagePreview.startsWith('blob:') ? v.imagePreview : undefined);
          return {
            name: v.label.trim(),
            price: p !== undefined && Number.isFinite(p) && p >= 0 ? p : undefined,
            imageUrl,
          };
        })
        .filter((v) => v.name.length > 0);

    const payload: Parameters<typeof onSubmit>[0] = {
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      category: values.category || undefined,
      media,
      // IMPORTANT: always include variations. [] explicitly clears on backend.
      variations,
      tags: tags.length ? tags : undefined,
    };

    if (!hasAnyVariants && hasMainPrice) {
      payload.price = priceNum;
      if (compareAtNum !== undefined) payload.compareAtPrice = compareAtNum;
    }

    // -------------------- CHANNEL + LOCATION EXCLUSIONS (NEW) --------------------
    const exactlyOneChannel = chDineIn !== chOnline;

    console.log('EXCLUSION CHECK', {
      chDineIn,
      chOnline,
      exactlyOneChannel,
      activeLocationId,
      payloadBefore: { ...payload },
    });

    if (exactlyOneChannel) {
      // the one the user kept ON
      const checked: 'dine-in' | 'online' = chDineIn ? 'dine-in' : 'online';
      // the one the user turned OFF
      const unchecked: 'dine-in' | 'online' = chDineIn ? 'online' : 'dine-in';

      // keep your current “seed to one channel” behavior
      payload.channel = checked;

      // add the actual exclusion fields the backend needs
      const pAny = payload as any;
      if (activeLocationId) {
        // location AND channel exclusion
        pAny.excludeChannelAt = unchecked;
        pAny.excludeChannelAtLocationIds = [activeLocationId];
      } else {
        // channel-only (global) exclusion
        pAny.excludeChannel = unchecked;
      }
    }
    // ---------------------------------------------------------------------------

    // Advanced -> branches (All locations view only)
    if (!activeLocationId && allLocations.length) {
      const allIds = allLocations.map((l) => l.id);
      const unchecked = allIds.filter((id) => !selectedBranchIds.has(id));
      if (unchecked.length > 0) {
        // We use exclude list for unchecked branches
        payload.excludeLocationIds = unchecked;
      }
    }

    clearSnapshot();
    setSaving(true);
    setLocalError(null);

    const minDelay = sleep(MIN_SAVE_MS);

    try {
      const maybe = onSubmit(payload);
      if (isPromise(maybe)) {
        await Promise.all([maybe, minDelay]); // wait for success + min duration
        try {
          await queryClient.invalidateQueries({
            predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tenant',
          });
        } catch {}
        setSaving(false);
        onClose(); // trigger slide-out
      } else {
        await minDelay;
        setSaving(false);
      }
    } catch (err) {
      await minDelay;
      setSaving(false);
      setLocalError(err instanceof Error ? err.message : 'Failed to save product.');
      scheduleScrollToError();
    }
  };

  // Also auto-scroll whenever a tracked error becomes present
  useEffect(() => {
    if (
      nameErr ||
      priceErr ||
      compareAtErr ||
      varNameError ||
      varImageError ||
      mediaImageError ||
      createCatMut.isError ||
      localError
    ) {
      scheduleScrollToError();
    }
  }, [
    nameErr,
    priceErr,
    compareAtErr,
    varNameError,
    varImageError,
    mediaImageError,
    createCatMut.isError,
    localError,
    scheduleScrollToError,
  ]);

  const handleBackdropClick = () => {
    if (saving) return; // block closing during saving
    saveSnapshot();
    onClose();
  };

  // Remount key for ImageUploadZone to flush local previews on rejection
  const [mediaSyncKey, setMediaSyncKey] = useState(0);

  // Remount key for Variations to clear any row imageError when Media changes (e.g., deletion)
  const [variationsSyncKey, setVariationsSyncKey] = useState(0);

  // Pin upload targets across pick/upload
  const pendingTargetsRef = useRef<
    Map<
      number,
      | { kind: 'variant'; realIdx: number }
      | { kind: 'base'; baseIdx: number; prev: string | null; added: boolean }
    >
  >(new Map());

  // Map merged gallery index -> underlying base index in values.imagePreviews
  const resolveBaseIndexFromMerged = useCallback(
    (mergedIndex: number) => {
      const original = values.imagePreviews || [];

      const variantCount = (typedVariants || []).length;

      const baseIndices: number[] = [];
      const vUrlSet = new Set(variantUrls);
      for (let j = 0; j < original.length; j++) {
        const u = original[j];
        if (u !== null && !vUrlSet.has(u)) baseIndices.push(j);
      }

      if (mergedIndex < variantCount) return original.length;

      const basePos = mergedIndex - variantCount;

      if (basePos < baseIndices.length) {
        return baseIndices[basePos];
      }
      const extra = basePos - baseIndices.length;
      return original.length + extra;
    },
    [typedVariants, variantUrls, values.imagePreviews]
  );

  const removeUrlEverywhere = (url: string) => {
    if (!url) return;

    setUiVariations((prev) =>
      prev.map((v) =>
        v.imageUrl === url || v.imagePreview === url ? { ...v, imageUrl: null, imagePreview: null } : v
      )
    );

    setValues((prev) => {
      const nextPreviews = prev.imagePreviews.slice();
      const nextFiles = prev.imageFiles.slice();
      const toRevoke: string[] = [];

      for (let j = nextPreviews.length - 1; j >= 0; j--) {
        if (nextPreviews[j] === url) {
          const revoke = nextPreviews[j];
          if (revoke?.startsWith('blob:')) toRevoke.push(revoke);
          nextPreviews.splice(j, 1);
          if (j < nextFiles.length) nextFiles.splice(j, 1);
        }
      }

      if (toRevoke.length) {
        requestAnimationFrame(() => {
          toRevoke.forEach((u) => {
            try {
              URL.revokeObjectURL(u);
            } catch {}
          });
        });
      }

      return {
        ...prev,
        imageFiles: nextFiles,
        imagePreviews: nextPreviews.length ? nextPreviews : [null],
      };
    });

    setRemoteUrls((prev) => prev.filter((u) => u !== url));
  };

  const handleZonePick = (i: number, file: File, url: string) => {
    setMediaImageError(null);

    const urlAtTile = galleryPreviews[i] || null;
    const isVariantTile =
      typeof urlAtTile === 'string' && (urlAtTile.startsWith('loading:') || variantUrls.includes(urlAtTile));

    if (isVariantTile && urlAtTile) {
      setUiVariations((prev) => {
        const next = prev.slice();
        const typed = next.filter((v) => v.label.trim() !== '');
        const idx = typed.findIndex((v) => {
          const final =
            v.imageUrl || (v.imagePreview && !v.imagePreview.startsWith('blob:') ? v.imagePreview : null);
          const sentinel = v.imagePreview && v.imagePreview.startsWith('blob:')
            ? `loading:${v.imagePreview}`
            : null;
          return final === urlAtTile || sentinel === urlAtTile;
        });
        if (idx < 0) return prev;
        const realIdx = next
          .map((v, idx2) => ({ v, idx2 }))
          .filter(({ v }) => v.label.trim() !== '')
          [idx]?.idx2;
        if (realIdx === undefined) return prev;

        // Pin exact variant slot
        pendingTargetsRef.current.set(i, { kind: 'variant', realIdx });

        const prevPreview = next[realIdx].imagePreview;
        if (prevPreview && prevPreview.startsWith('blob:')) {
          safeRevoke(prevPreview);
        }
        next[realIdx] = { ...next[realIdx], imagePreview: url, imageUrl: null };
        return deepEqual(prev, next) ? prev : next;
      });
      return;
    }

    // Base tile or "add" tile (after variants)
    const baseRealIdx = resolveBaseIndexFromMerged(i);
    const originalLength = values.imagePreviews.length;
    const added = baseRealIdx >= originalLength;
    const prevAtIndex = !added ? values.imagePreviews[baseRealIdx] ?? null : null;

    pendingTargetsRef.current.set(i, { kind: 'base', baseIdx: baseRealIdx, prev: prevAtIndex, added });

    handlePickAt(baseRealIdx, file, url);
  };

  const handleZoneUploaded = (i: number, resp: { cdn: { medium: string } }) => {
    const pinned = pendingTargetsRef.current.get(i);
    const cdnUrl = resp.cdn.medium;

    if (pinned?.kind === 'variant') {
      let duplicate = false;
      setUiVariations((prev) => {
        const next = prev.slice();
        const realIdx = pinned.realIdx;
        if (realIdx < 0 || realIdx >= next.length) return prev;

        const existsElsewhere = next.some((v, j) => {
          if (j === realIdx) return false;
          const u = v.imageUrl || (v.imagePreview && !v.imagePreview.startsWith('blob:') ? v.imagePreview : null);
          return u === cdnUrl;
        });
        if (existsElsewhere) {
          duplicate = true;
          return prev;
        }

        next[realIdx] = { ...next[realIdx], imagePreview: cdnUrl, imageUrl: cdnUrl };
        return deepEqual(prev, next) ? prev : next;
      });
      setVarImageError(duplicate ? 'Each variation must have a unique image.' : null);
      pendingTargetsRef.current.delete(i);
      return;
    }

    if (pinned?.kind === 'base') {
      const baseIdx = pinned.baseIdx;

      const existsInVariants = variantUrls.includes(cdnUrl);
      const existsInBase = (values.imagePreviews || []).some(
        (u, j) => j !== baseIdx && !!u && !u.startsWith('blob:') && u === cdnUrl
      );

      if (existsInVariants || existsInBase) {
        setMediaImageError('Image already exists.');
        setValues((prev) => {
          const next = prev.imagePreviews.slice();
          const current = next[baseIdx];
          if (current && current.startsWith('blob:')) safeRevoke(current);
          if (pinned.added) {
            if (baseIdx < next.length) next.splice(baseIdx, 1);
            return { ...prev, imagePreviews: next.length ? next : [null] };
          } else {
            next[baseIdx] = pinned.prev ?? null;
            return { ...prev, imagePreviews: next };
          }
        });
        setMediaSyncKey((k) => k + 1);
        pendingTargetsRef.current.delete(i);
        return;
      }

      setMediaImageError(null);
      handleUploadedAt(baseIdx, cdnUrl);
      pendingTargetsRef.current.delete(i);
      return;
    }

    // Fallback (no pinned target)
    const baseIdx = resolveBaseIndexFromMerged(i);
    const existsInVariants = variantUrls.includes(cdnUrl);
    const existsInBase = (values.imagePreviews || []).some(
      (u, j) => j !== baseIdx && !!u && !u.startsWith('blob:') && u === cdnUrl
    );

    if (existsInVariants || existsInBase) {
      setMediaImageError('Image already exists.');
      setValues((prev) => {
        const next = prev.imagePreviews.slice();
        const current = next[baseIdx];
        if (current && current.startsWith('blob:')) safeRevoke(current);
        next[baseIdx] = null;
        return { ...prev, imagePreviews: next };
      });
      setMediaSyncKey((k) => k + 1);
      return;
    }

    setMediaImageError(null);
    handleUploadedAt(baseIdx, cdnUrl);
  };

  const handleZoneClear = (i: number) => {
    pendingTargetsRef.current.delete(i);
    setMediaImageError(null);
    const urlAtTile = galleryPreviews[i] || null;
    if (!urlAtTile) return;
    removeUrlEverywhere(urlAtTile);
    setVariationsSyncKey((k) => k + 1);
  };

  const handlePickAt = (index: number, file: File, previewUrl: string) => {
    setValues((prev) => {
      const nextFiles = prev.imageFiles.slice();
      const nextPreviews = prev.imagePreviews.slice();
      const prevUrl = nextPreviews[index];
      if (prevUrl && prevUrl !== previewUrl && prevUrl.startsWith('blob:')) {
        safeRevoke(prevUrl);
      }
      while (nextFiles.length <= index) nextFiles.push(null);
      while (nextPreviews.length <= index) nextPreviews.push(null);
      nextFiles[index] = file;
      nextPreviews[index] = previewUrl;
      const next = { ...prev, imageFiles: nextFiles, imagePreviews: nextPreviews };
      return deepEqual(prev, next) ? prev : next;
    });
  };

  const handleUploadedAt = (index: number, url: string) => {
    setValues((prev) => {
      const next = prev.imagePreviews.slice();
      while (next.length <= index) next.push(null);
      next[index] = url;
      const merged = { ...prev, imagePreviews: next };
      return deepEqual(prev, merged) ? prev : merged;
    });
    setRemoteUrls((prev) => {
      const next = prev.slice();
      while (next.length <= index) next.push('');
      next[index] = url;
      return next;
    });
  };

  const handleVariationsChange = useCallback((list: UiVariation[]) => {
    const typed = (list || []).filter((v) => v.label.trim() !== '');
    const nameSet = new Set<string>();
    let nameDup = false;
    for (const v of typed) {
      const key = v.label.trim().toLowerCase();
      if (nameSet.has(key)) {
        nameDup = true;
        break;
      }
      nameSet.add(key);
    }

    const urlSet = new Set<string>();
    let imgDup = false;
    for (const v of typed) {
      const u = v.imageUrl || (v.imagePreview && !v.imagePreview.startsWith('blob:') ? v.imagePreview : null);
      if (u) {
        if (urlSet.has(u)) {
          imgDup = true;
          break;
        }
        urlSet.add(u);
      }
    }

    setVarNameError(nameDup ? 'Each variation must have a unique name.' : null);
    setVarImageError(imgDup ? 'Each variation must have a unique image.' : null);
    setUiVariations((prev) => (deepEqual(prev, list) ? prev : list));
  }, []);

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
        aria-busy={saving || undefined}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#dbdbdb] sticky top-0 bg-[#fcfcfc]">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-[#2e2e30]">{title}</h3>
            {/* Local scope badge (hide on All locations + All channels) */}
            {activeLocationId ? (
              (() => {
                const locationDisplay = (() => {
                  const loc = allLocations.find((l) => l.id === activeLocationId);
                  return loc?.name || 'Current location';
                })();
                const singleChannel = chDineIn !== chOnline ? (chDineIn ? 'Dine-In' : 'Online') : null;
                const text = singleChannel ? `${locationDisplay} • ${singleChannel}` : locationDisplay;
                return (
                  <span
                    className="inline-flex items-center gap-2 rounded-full border border-[#dbdbdb] bg-[#fcfcfc] px-2.5 py-1 text-xs text-[#2e2e30] max-w-[60%] truncate"
                    title={text}
                    aria-label={`Scope: ${text}`}
                  >
                    <span className="truncate">{text}</span>
                  </span>
                );
              })()
            ) : null}
          </div>
          <button
            className={`text-[#6b7280] hover:text-[#374151] ${saving ? 'cursor-not-allowed opacity-60' : ''}`}
            onClick={handleBackdropClick}
            aria-label="Close"
            disabled={saving}
            type="button"
          >
            ✕
          </button>

          {saving && (
            <div className="absolute left-0 right-0 bottom-0 h-0.5 overflow-hidden">
              <motion.div
                className="h-full bg-[#111827]"
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{ duration: 1.2, ease: 'easeInOut', repeat: Infinity }}
              />
            </div>
          )}
        </div>

        <form
          id="product-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-5 bg-[#fcfcfc]"
          ref={scrollRef as any}
        >
          <div className="space-y-5">
            <Field>
              <Label>Item Name</Label>
              <Input
                value={values.name}
                onChange={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  setValues((prev) => ({ ...prev, name: v }));
                  if (nameErr) setNameErr(null);
                }}
                placeholder="e.g., Chicken Biryani"
                className={nameErr ? 'border-red-500' : ''}
                required
                aria-invalid={!!nameErr || undefined}
              />
              {nameErr && (
                <div className="mt-1 text-xs text-red-600" role="alert" aria-live="polite">
                  {nameErr}
                </div>
              )}
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <LabelRow text="Price" />
                <CurrencyInput
                  value={allowMainPrice ? values.price : ''}
                  onChange={(v: string) => {
                    setValues((prev) => ({ ...prev, price: v }));
                    if (priceErr) setPriceErr(null);
                    if (compareAtErr) setCompareAtErr(null);
                  }}
                  placeholder={allowMainPrice ? '0.00' : 'Set by Variations'}
                  disabled={!allowMainPrice}
                  invalid={!!priceErr}
                />
                {priceErr && (
                  <div className="mt-1 text-xs text-red-600" role="alert" aria-live="polite">
                    {priceErr}
                  </div>
                )}
              </Field>

              {allowMainPrice && (
                <Field>
                  <LabelRow
                    text="Compare-at Price"
                    help="Enter a value higher than your product price to show a markdown."
                    placement="left"
                  />
                  <CurrencyInput
                    value={values.compareAtPrice || ''}
                    onChange={(v: string) => {
                      setValues((prev) => ({ ...prev, compareAtPrice: v }));
                      if (compareAtErr) setCompareAtErr(null);
                    }}
                    placeholder="0.00"
                    disabled={!hasMainPrice}
                    invalid={!!compareAtErr}
                  />
                  {compareAtErr && (
                    <div className="mt-1 text-xs text-red-600" role="alert" aria-live="polite">
                      {compareAtErr}
                    </div>
                  )}
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
                key={mediaSyncKey} // keep instance stable during uploads
                previews={galleryPreviews}
                readOnlyCount={0}
                maxCount={MAX_MEDIA}
                uploadUrl={`${API_BASE}/api/uploads/images`}
                authToken={token || undefined}
                onPick={handleZonePick}
                onUploaded={handleZoneUploaded}
                onClear={handleZoneClear}
              />
              {mediaImageError && (
                <div className="mt-2 text-sm text-red-600 truncate" role="alert" aria-live="polite">
                  {mediaImageError}
                </div>
              )}
            </Field>

            <Variations
              key={variationsSyncKey}
              value={uiVariations}
              onChange={handleVariationsChange}
              uploadUrl={`${API_BASE}/api/uploads/images`}
              authToken={token || undefined}
              mediaUrls={mediaUrls}
              validatePricesTick={varPriceValidateTick}
              onImageRemove={(_, url) => {
                if (url) removeUrlEverywhere(url);
              }}
            />
            {/* Only show global image error; duplicate-name error is hidden here */}
            {varImageError && (
              <div className="text-sm text-red-600" role="alert" aria-live="polite">
                {varImageError}
              </div>
            )}

            <Field>
              <Tags value={tags} onChange={setTags} />
            </Field>

            {/* Advanced section */}
            <div className="mt-2">
              <button
                type="button"
                className="text-sm font-medium text-[#2e2e30] underline-offset-2 hover:underline"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                Advanced {advancedOpen ? '⌃' : '⌄'}
              </button>

              {advancedOpen && (
                <div className="mt-3 space-y-4 rounded-md border border-[#e6e6e8] bg-white p-3">
                  {/* Channels */}
                  <div>
                    <div className="text-sm font-medium text-[#2e2e30] mb-1">Channels</div>
                    <div className="flex items-center gap-4">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={chDineIn}
                          onChange={(e) => setChDineIn(e.currentTarget.checked)}
                        />
                        <span className="text-sm text-[#2e2e30]">Dine-In</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={chOnline}
                          onChange={(e) => setChOnline(e.currentTarget.checked)}
                        />
                        <span className="text-sm text-[#2e2e30]">Online</span>
                      </label>
                    </div>
                    {!chDineIn && !chOnline ? (
                      <div className="mt-1 text-xs text-red-600" role="alert">
                        Select at least one channel.
                      </div>
                    ) : null}
                  </div>

                  {/* Branches */}
                  {!activeLocationId ? (
                    <div>
                      <div className="text-sm font-medium text-[#2e2e30] mb-1">Branches</div>
                      {locationsQuery.isLoading ? (
                        <div className="text-sm text-[#6b6b70]">Loading branches…</div>
                      ) : allLocations.length ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                          {allLocations.map((loc) => {
                            const checked = selectedBranchIds.has(loc.id);
                            return (
                              <label key={loc.id} className="inline-flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(selectedBranchIds);
                                    if (e.currentTarget.checked) next.add(loc.id);
                                    else next.delete(loc.id);
                                    setSelectedBranchIds(next);
                                  }}
                                />
                                <span className="text-sm text-[#2e2e30]">{loc.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-sm text-[#6b6b70]">No branches found.</div>
                      )}
                      {allLocations.length > 0 && selectedBranchIds.size === 0 ? (
                        <div className="mt-1 text-xs text-red-600" role="alert">
                          Select at least one branch.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-[#6b6b70]">
                      This product will be created only in the current location.
                    </div>
                  )}
                </div>
              )}
            </div>

            {(localError || createCatMut.isError) && (
              <div className="text-sm text-red-600" role="alert" aria-live="polite">
                {localError || (createCatMut.error as Error)?.message || 'Something went wrong.'}
              </div>
            )}
          </div>
        </form>

        <div className="px-5 py-4 border-t border-[#dbdbdb] sticky bottom-0 bg-[#fcfcfc] flex justify-end gap-3">
          <button
            type="button"
            className={`px-4 py-2 rounded-md border border-[#dbdbdb] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6] hover:border-[#111827] ${
              saving ? 'opacity-60 cursor-not-allowed' : ''
            }`}
            onClick={() => {
              if (saving) return;
              clearSnapshot();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="product-form"
            className={`px-4 py-2 rounded-md text-sm text-white ${
              saving ? 'bg-[#111827] cursor-wait' : 'bg-[#111827] hover:opacity-90'
            }`}
            disabled={isSaveDisabled}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </motion.aside>
    </div>
  );
}

function Field({ children }: { children: ReactNode }) {
  return <div className="text-[#2e2e30]">{children}</div>;
}
function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <label className={`block text-sm font-medium text-[#2e2e30] mb-1 ${className}`}>{children}</label>;
}
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
      className={`pointer-events-none absolute ${pos} z-50 max-w-[22rem] w-80 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-xs text-[#2e2e30] shadow-md opacity-0 translate-y-0 transition duration-150 ease-out group-hover:translate-y-[2px] group-hover:opacity-100`}
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
      className={`w-full rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] transition-colors hover:border-[#111827] focus:border-[#111827] focus:outline-none focus:ring-0 ${className || ''}`}
    />
  );
}
function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`w-full rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] transition-colors hover:border-[#111827] focus:border-[#111827] focus:outline-none focus:ring-0 ${className || ''}`}
    />
  );
}
function CurrencyInput({
  value,
  onChange,
  placeholder = '0.00',
  disabled = false,
  invalid = false,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="flex items-stretch">
      <span className="select-none rounded-l-md border border-[#dbdbdb] bg-[#fcfcfc] px-2 py-2 text-sm text-[#6b7280]">
        ৳
      </span>
      <input
        className={`w-full -ml-px rounded-r-md rounded-l-none border bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] transition-colors focus:outline-none focus:ring-0 ${
          invalid
            ? 'border-red-500 focus:border-red-500'
            : 'border-[#dbdbdb] hover:border-[#111827] focus:border-[#111827]'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
        inputMode="decimal"
      />
    </div>
  );
}
