// The guest site's theme: the restaurant's choice; restaurants from before themes keep the original look; the admin's
// preview ("?theme=") applies to that tab only and "?theme=live" ends it.
jest.mock('../api/storefront', () => ({ getTenant: jest.fn() })); // (its module reads Vite's import.meta)
import { previewTheme, themeOf } from '../themes/theme';

describe('themeOf', () => {
  it('is null while the restaurant loads', () => {
    expect(themeOf(null)).toBeNull();
    expect(themeOf(undefined)).toBeNull();
  });
  it('keeps the original look when none is set (restaurants from before themes)', () => {
    expect(themeOf({})).toBe('petal');
    expect(themeOf({ theme: 'something-else' })).toBe('petal');
  });
  it('follows the restaurant’s theme', () => {
    expect(themeOf({ theme: 'ember' })).toBe('ember');
    expect(themeOf({ theme: 'petal' })).toBe('petal');
  });
});

describe('previewTheme', () => {
  const go = (search: string) => window.history.replaceState(null, '', `/t/demo${search}`);
  beforeEach(() => {
    sessionStorage.clear();
    go('');
  });
  it('is none without ?theme=', () => {
    expect(previewTheme('demo')).toBeNull();
  });
  it('takes ?theme= and keeps it for the tab while the owner clicks around', () => {
    go('?theme=ember');
    expect(previewTheme('demo')).toBe('ember');
    go('/menu');
    expect(previewTheme('demo')).toBe('ember');
    expect(previewTheme('other-restaurant')).toBeNull();
  });
  it('ignores unknown themes and ends with ?theme=live', () => {
    go('?theme=neon');
    expect(previewTheme('demo')).toBeNull();
    go('?theme=petal');
    expect(previewTheme('demo')).toBe('petal');
    go('?theme=live');
    expect(previewTheme('demo')).toBeNull();
    go('');
    expect(previewTheme('demo')).toBeNull();
  });
});
