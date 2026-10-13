// apps/tastebud/src/components/TrackPageViews.tsx
// Every storefront page shown (and a visit's QR scan) → utils/track.ts, for the company's Cortex panel.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../utils/track';

export default function TrackPageViews() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    trackPageView(pathname, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]); // a new page, not every query change (the table / key being tidied on the same page)
  return null;
}
