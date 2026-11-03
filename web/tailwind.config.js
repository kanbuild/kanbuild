import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        gold: { DEFAULT: 'hsl(var(--gold))', foreground: 'hsl(var(--gold-foreground))' },
        metal: { DEFAULT: 'hsl(var(--metal-hi))', edge: 'hsl(var(--metal-edge))' },
      },
      boxShadow: {
        glow: '0 0 0 1px hsl(var(--primary) / 0.45), 0 0 22px -4px hsl(var(--accent-glow))',
        'gold-glow': '0 0 0 1px hsl(var(--gold) / 0.7), 0 0 18px -4px hsl(var(--gold) / 0.55)',
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      // Motion: enter with a soft spring (ease-out-expo), leave faster with ease-in. Keyframes own the
      // whole `transform`, so animated elements must not be positioned with translate (see ui/dialog.tsx).
      keyframes: {
        indeterminate: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(250%)' } },
        'overlay-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'overlay-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'dialog-in': { from: { opacity: '0', transform: 'translateY(12px) scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
        'dialog-out': { from: { opacity: '1', transform: 'none' }, to: { opacity: '0', transform: 'translateY(6px) scale(0.98)' } },
        'sheet-in': { from: { opacity: '0.6', transform: 'translateX(100%)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-out': { from: { opacity: '1', transform: 'none' }, to: { opacity: '0.6', transform: 'translateX(100%)' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(-4px) scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
        'toast-in': { from: { opacity: '0', transform: 'translateY(12px) scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        lift: { from: { transform: 'rotate(0deg) scale(1)' }, to: { transform: 'rotate(1deg) scale(1.03)' } },
      },
      animation: {
        indeterminate: 'indeterminate 1.4s ease-in-out infinite',
        'overlay-in': 'overlay-in 200ms ease-out',
        'overlay-out': 'overlay-out 150ms ease-in forwards',
        'dialog-in': 'dialog-in 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-out': 'dialog-out 150ms ease-in forwards',
        'sheet-in': 'sheet-in 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        'sheet-out': 'sheet-out 200ms ease-in forwards',
        'pop-in': 'pop-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-in': 'toast-in 300ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-up': 'fade-up 200ms ease-out',
        lift: 'lift 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
    },
  },
  plugins: [animate],
};
