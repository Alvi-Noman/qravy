import sharp from 'sharp';
import { appIcon, appManifest, sellsOnline, shortName } from '../appRoutes.js';

const t = { name: 'Burger House Gulshan', logoUrl: null, storefrontTheme: 'ember', waiterLanguage: 'bn', restaurantInfo: { onlineSalesEnabled: true } } as any;

describe("the restaurant's app", () => {
  it('opens the online shop, never a table — on its own address and in development', () => {
    const m = appManifest(t, { sub: 'burger-house', base: '', branch: null });
    expect(m.start_url).toBe('/?source=homescreen');
    expect(m.scope).toBe('/');
    const dev = appManifest(t, { sub: 'burger-house', base: '/t/burger-house', branch: 'gulshan' });
    expect(dev.start_url).toBe('/t/burger-house/gulshan/?source=homescreen');
    expect(dev.scope).toBe('/t/burger-house/');
    expect(dev.id).toBe('/t/burger-house/gulshan/');
  });

  it('name, colours, icons', () => {
    const m = appManifest(t, { sub: 'burger-house', base: '', branch: null });
    expect(m.name).toBe('Burger House Gulshan');
    expect(m.short_name).toBe('Burger House');
    expect(m.background_color).toBe('#0B0B0C');
    expect(m.display).toBe('standalone');
    expect(m.icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    expect(appManifest({ ...t, storefrontTheme: 'petal' }, { sub: 'x', base: '', branch: null }).theme_color).toBe('#FFFFFF');
  });

  it('short names fit under the icon', () => {
    expect(shortName('Kacchi Bhai')).toBe('Kacchi Bhai');
    expect(shortName('Sultan’s Dine Banani')).toBe('Sultan’s'); // ('Sultan’s Dine' is 13)
    expect(shortName('Supercalifragilistic')).toBe('Supercalifra'.slice(0, 12));
  });

  it('only restaurants that sell online have an app', () => {
    expect(sellsOnline(t)).toBe(true);
    expect(sellsOnline({ restaurantInfo: { onlineSalesEnabled: false } } as any)).toBe(false);
    expect(sellsOnline(null)).toBe(false);
  });

  it('no logo yet: a square icon with the initials', async () => {
    const png = await appIcon(t, 192, false);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([192, 192, 'png']);
  });
});
