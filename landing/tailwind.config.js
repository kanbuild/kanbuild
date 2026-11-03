import dashboard from '../web/tailwind.config.js';

/** @type {import('tailwindcss').Config} */
export default {
  // Same tokens, radius, dark mode and plugins as the dashboard.
  presets: [dashboard],
  content: ['./index.html', './donate/index.html', './src/**/*.{ts,tsx}', '../web/src/components/ui/**/*.{ts,tsx}'],
};
