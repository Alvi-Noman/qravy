// The restaurant's app: which phone and browser opened /app (each gets its own way to install), and where things live.
jest.mock('../utils/track', () => ({ track: jest.fn() }));

import { chromeIntent, installHref, manifestHref, phoneOf, shopHref, siteBase } from '../pwa/pwa';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidWebview: 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  laptop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
};

describe('which phone opened /app', () => {
  it('Android: Chrome, or an app\'s built-in browser', () => {
    expect(phoneOf(UA.androidChrome)).toMatchObject({ os: 'android', inApp: null });
    expect(phoneOf(UA.androidWebview)).toMatchObject({ os: 'android', inApp: 'other' });
    expect(phoneOf(UA.androidFacebook)).toMatchObject({ os: 'android', inApp: 'facebook' });
  });
  it('iPhone: Safari, Chrome, or Instagram', () => {
    expect(phoneOf(UA.iphoneSafari)).toMatchObject({ os: 'ios', iosBrowser: 'safari', inApp: null });
    expect(phoneOf(UA.iphoneChrome)).toMatchObject({ os: 'ios', iosBrowser: 'chrome' });
    expect(phoneOf(UA.iphoneInstagram)).toMatchObject({ os: 'ios', inApp: 'instagram' });
  });
  it('an iPad pretends to be a Mac — its touch screen gives it away', () => {
    expect(phoneOf(UA.ipad).os).toBe('desktop');
    expect(phoneOf(UA.ipad, { touchMac: true }).os).toBe('ios');
  });
  it('a computer', () => {
    expect(phoneOf(UA.laptop)).toMatchObject({ os: 'desktop', inApp: null });
  });
});

describe('where things live', () => {
  it('development (/t/<sub>) and the restaurant\'s own address', () => {
    expect(siteBase('/t/burger-house/app')).toBe('/t/burger-house');
    expect(siteBase('/gulshan/app')).toBe('');
    expect(shopHref('/t/burger-house', 'gulshan')).toBe('/t/burger-house/gulshan/');
    expect(installHref('', null)).toBe('/app');
    expect(manifestHref('burger-house', '/t/burger-house', null)).toBe('/api/v1/public/app/burger-house/manifest.webmanifest?base=%2Ft%2Fburger-house');
  });
  it('Android: open this page in Chrome from another app', () => {
    expect(chromeIntent('https://burgerhouse.qravy.com/app?src=card')).toBe(
      'intent://burgerhouse.qravy.com/app?src=card#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fburgerhouse.qravy.com%2Fapp%3Fsrc%3Dcard;end',
    );
  });
});
