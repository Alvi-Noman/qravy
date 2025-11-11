// Copies tastebud build into a predictable place if present during CI image build.
// In local dev you’ll run Vite (DEV_VITE_ORIGIN) so this is mostly for production images.
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../../../apps/tastebud/dist');
const dest = path.resolve(__dirname, '../public');

if (fs.existsSync(src)) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // shallow copy (enough for index.html + assets)
  const entries = fs.readdirSync(src);
  for (const name of entries) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    fs.cpSync(from, to, { recursive: true });
  }
  console.log(`[copy-static] copied ${src} -> ${dest}`);
} else {
  console.log(`[copy-static] skip (no ${src})`);
}
