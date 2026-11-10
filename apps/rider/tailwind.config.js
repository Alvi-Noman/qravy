/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { fontFamily: { sans: ['Inter', '"Noto Sans Bengali"', 'system-ui', 'sans-serif'] } } },
  plugins: [],
};
