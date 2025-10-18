/**
 * ResponsiveImg
 *
 * - AVIF/WebP first, fallback to auto.
 * - Two modes:
 *   1) Width-based: pass widths[] + sizes string → browser picks best width.
 *   2) DPR-based: pass fixedWidth + dprs[] (e.g., [1,2]) for 1x/2x slots.
 * - Blur-up placeholder (small, blurred image) that fades into the final image.
 *
 * Props:
 * - ikKey: R2 key (e.g., "images/<hash>.png")
 * - alt: string
 * - widths?: number[] (width-based mode)
 * - sizes?: string (width-based mode)
 * - fixedWidth?: number (DPR mode; e.g., 200)
 * - dprs?: number[] (DPR mode; e.g., [1, 2])
 * - className?: string
 * - priority?: boolean (eager load for hero)
 * - placeholder?: boolean (default true)
 * - placeholderWidth?: number (default 24)
 * - placeholderBlur?: number (default 20)
 * - objectFit?: 'cover' | 'contain' (default 'cover')
 * - aspectRatio?: string (e.g., "1 / 1" or "16 / 9") to avoid CLS
 */
import React from 'react';
import { buildImgUrl } from '../utils/image';

type Props = {
  ikKey: string;
  alt: string;
  // Width-based mode
  widths?: number[];
  sizes?: string;
  // DPR-based mode (fixed logical width)
  fixedWidth?: number;
  dprs?: number[];
  // UI
  className?: string;
  priority?: boolean;
  placeholder?: boolean;
  placeholderWidth?: number;
  placeholderBlur?: number;
  objectFit?: 'cover' | 'contain';
  aspectRatio?: string;
};

function buildWidthSrcSet(ikKey: string, list: number[], q: number, format: 'auto' | 'webp' | 'avif') {
  return list.map((w) => `${buildImgUrl(ikKey, { w, q, format })} ${w}w`).join(', ');
}

function buildDprSrcSet(ikKey: string, width: number, dprs: number[], q: number, format: 'auto' | 'webp' | 'avif') {
  return dprs.map((dpr) => `${buildImgUrl(ikKey, { w: width, dpr, q, format })} ${dpr}x`).join(', ');
}

export function ResponsiveImg({
  ikKey,
  alt,
  widths,
  sizes = '(max-width: 600px) 200px, (max-width: 1024px) 400px, 800px',
  fixedWidth,
  dprs = [1, 2],
  className,
  priority = false,
  placeholder = true,
  placeholderWidth = 24,
  placeholderBlur = 20,
  objectFit = 'cover',
  aspectRatio
}: Props) {
  const [loaded, setLoaded] = React.useState(false);

  const isDprMode = typeof fixedWidth === 'number' && fixedWidth > 0 && Array.isArray(dprs) && dprs.length > 0;

  const avifSrcSet = isDprMode
    ? buildDprSrcSet(ikKey, fixedWidth!, dprs, 70, 'avif')
    : buildWidthSrcSet(ikKey, widths || [200, 400, 800], 70, 'avif');

  const webpSrcSet = isDprMode
    ? buildDprSrcSet(ikKey, fixedWidth!, dprs, 75, 'webp')
    : buildWidthSrcSet(ikKey, widths || [200, 400, 800], 75, 'webp');

  const autoSrcSet = isDprMode
    ? buildDprSrcSet(ikKey, fixedWidth!, dprs, 80, 'auto')
    : buildWidthSrcSet(ikKey, widths || [200, 400, 800], 80, 'auto');

  const defaultSrc = isDprMode
    ? buildImgUrl(ikKey, { w: fixedWidth!, q: 80, format: 'auto' })
    : buildImgUrl(ikKey, { w: Math.min(800, (widths || [200, 400, 800]).slice(-1)[0]), q: 80, format: 'auto' });

  const placeholderSrc =
    placeholder && placeholderWidth > 0
      ? buildImgUrl(ikKey, { w: placeholderWidth, q: 20, format: 'auto', blur: placeholderBlur })
      : undefined;

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    ...(aspectRatio ? { aspectRatio } : {})
  };

  const imgStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit,
    display: 'block',
    opacity: loaded ? 1 : 0,
    transition: 'opacity 250ms ease'
  };

  const placeholderStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit,
    filter: `blur(${Math.max(1, placeholderBlur)}px)`,
    transform: 'scale(1.05)',
    transition: 'opacity 200ms ease',
    opacity: loaded ? 0 : 1
  };

  return (
    <div className={className} style={containerStyle}>
      {placeholderSrc && (
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden="true"
          style={placeholderStyle}
          decoding="async"
          loading="eager"
        />
      )}

      <picture>
        <source type="image/avif" srcSet={avifSrcSet} {...(!isDprMode ? { sizes } : {})} />
        <source type="image/webp" srcSet={webpSrcSet} {...(!isDprMode ? { sizes } : {})} />
        <img
          src={defaultSrc}
          srcSet={autoSrcSet}
          {...(!isDprMode ? { sizes } : {})}
          alt={alt}
          style={imgStyle}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? ('high' as any) : ('auto' as any)}
          onLoad={() => setLoaded(true)}
        />
      </picture>
    </div>
  );
}

export default ResponsiveImg;