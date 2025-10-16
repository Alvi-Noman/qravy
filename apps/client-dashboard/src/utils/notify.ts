// Centralized notifier for locations list changes.
// Triggers same-tab (CustomEvent) and cross-tab (localStorage) updates.
export function notifyLocationsUpdated(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('locations:updated'));
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('locations:updated', String(Date.now()));
    }
  } catch {
    // no-op
  }
}