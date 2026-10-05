// apps/tastebud/src/components/KeepTableInUrl.tsx
// Keeps every guest on the right side of the restaurant's site (utils/table — splitStorePath):
//   online  → "/t/burger-house"                  — the online shop (pickup / delivery, name / phone / address)
//   dine-in → "/t/burger-house/dine-in?table=12&k=<key>" — the table's QR code; every page under it keeps both
// So:
//   - a table in an online link (QR codes printed before "/dine-in" existed: "/t/burger-house?table=12", the old
//     "/menu/dine-in") moves to the dine-in side, with its table;
//   - a dine-in link with no table ("/t/burger-house/dine-in", the number erased) asks for it first (DineInGate);
//   - a restaurant that only does one of the two never shows the other.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getTableKey, normalizeTable, setTable, splitStorePath, storeSubFromPath } from '../utils/table';
import { useStoreChannels } from '../utils/order-mode';

const NOT_A_STORE = /^\/(demo|voice-test)(\/|$)/;

export default function KeepTableInUrl() {
  const location = useLocation();
  const navigate = useNavigate();
  const sub = NOT_A_STORE.test(location.pathname) ? null : storeSubFromPath(location.pathname);
  const { dineIn: dineInOn, online: onlineOn, loaded } = useStoreChannels(sub);

  useEffect(() => {
    if (!sub) return; // the directory of restaurants, the demos
    const { pathname, search, hash, state } = location;
    const { base, dineIn, rest } = splitStorePath(pathname);
    const params = new URLSearchParams(search);
    const urlTable = normalizeTable(params.get('table'));

    const legacyDineInMenu = /^\/menu\/dine-in\/?$/.test(rest); // the old "/menu/dine-in"
    let toDineIn = dineIn || legacyDineInMenu || !!urlTable; // a table in the link = a table guest
    if (loaded && toDineIn && !dineInOn && onlineOn) toDineIn = false; // the restaurant doesn't serve at tables
    if (loaded && !toDineIn && !onlineOn && dineInOn) toDineIn = true; // … or doesn't sell online

    if (toDineIn && urlTable) {
      setTable(sub, urlTable, params.get('k')); // remembered, with its QR key, for a page that drops it
      const k = getTableKey(sub, urlTable); // the key this phone scanned for this table, if the link lost it
      if (k && params.get('k') !== k) params.set('k', k);
    }
    if (!toDineIn) {
      params.delete('table');
      params.delete('k');
    }

    const path = `${base}${toDineIn ? '/dine-in' : ''}${legacyDineInMenu ? '/menu' : rest}` || '/';
    const query = params.toString();
    if (path === pathname && query === search.replace(/^\?/, '')) return;
    navigate({ pathname: path, search: query ? `?${query}` : '', hash }, { replace: true, state });
  }, [location, navigate, sub, dineInOn, onlineOn, loaded]);

  return null;
}
