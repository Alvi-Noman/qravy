// apps/rider/scripts/make-icons.mjs — the app icon (a scooter on teal) as PNGs for the PWA and the Android app.
// Run: pnpm --filter rider icons   (uses sharp from the workspace)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  const { readdirSync } = await import('node:fs');
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/.pnpm');
  const dir = readdirSync(root).find((d) => d.startsWith('sharp@'));
  sharp = require(join(root, dir, 'node_modules/sharp'));
}

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

// a scooter with a delivery box, white on teal; `pad` shrinks it for the maskable icon's safe zone
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#0F766E"/>
  <g transform="translate(256 262) scale(${pad ? 0.72 : 0.9}) translate(-256 -262)" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round">
    <rect x="118" y="150" width="120" height="96" rx="14" fill="#fff" stroke="none"/>
    <circle cx="160" cy="352" r="44"/>
    <circle cx="364" cy="352" r="44"/>
    <path d="M160 352h120l44-110h52"/>
    <path d="M116 300h132l32 52"/>
    <path d="M330 242l34 110"/>
  </g>
</svg>`;

for (const [name, size, pad] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
]) {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png().toFile(join(out, name));
  console.log('wrote', name);
}
