// apps/tastebud/src/utils/welcome.ts
// The waiter's default welcome (when the restaurant hasn't written its own in Settings → Guest messages) — the
// owner's wording, word for word as on the original home screen (pages/AIWaiterHome.tsx: welcomeText). Every theme
// uses it; change the wording in both places together, and only when the owner asks.
const WELCOME_BN =
  'স্বাগতম! আমি পিক্সি - আপনার ভার্চুয়াল ওয়েটার। মেনু থেকে যেকোনো কিছু জানতে চাইলে কিংবা অর্ডার করতে আমাকে বলুন।';

// "{Restaurant}-এ স্বাগতম, আমি পিক্সি…" — plain "স্বাগতম!" until the restaurant's name has loaded
// the waiter's name is the restaurant's own (Settings → AI Waiter); "Pixie" (পিক্সি) when they haven't named it
export function welcomeText(lang: 'bn' | 'en', restaurant?: string | null, waiter?: string | null): string {
  const name = (restaurant || '').trim();
  const own = (waiter || '').trim();
  const named = own && !/^pixie$/i.test(own) ? own : '';
  if (lang === 'en') {
    return `${name ? `Welcome to ${name}!` : 'Welcome!'} I'm ${named || 'Pixie'}, your virtual waiter. Ask me anything about the menu, or tell me what you'd like to order.`;
  }
  const base = named ? WELCOME_BN.replace('আমি পিক্সি', `আমি ${named}`) : WELCOME_BN;
  if (!name) return base;

  const isBurgerHouse = /^burger[\s-]+house$/i.test(name);
  const banglaGreeting = isBurgerHouse
    ? 'বার্গার হাউসে স্বাগতম'
    : `${name}-এ স্বাগতম`;
  return base.replace('স্বাগতম! আমি', `${banglaGreeting}, আমি`);
}
