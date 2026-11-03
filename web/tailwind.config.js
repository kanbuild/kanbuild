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
      keyframes: {
        indeterminate: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(250%)' } },
      },
      animation: { indeterminate: 'indeterminate 1.4s ease-in-out infinite' },
    },
  },
  plugins: [animate],
};
