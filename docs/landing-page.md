# Landing page (`landing/`)

Source files: `landing/index.html`, `landing/donate/index.html`, `landing/src/*.tsx`, `landing/src/config.ts`, `landing/vite.config.ts`, `landing/tailwind.config.js`, `landing/package.json`, `landing/public/*`

The public Kanbuild marketing site. It is a static, multi-page Vite + React + Tailwind app with no router and no backend. You host it yourself on any static host. It is **not** served by the Kanbuild backend.

## Pages

| URL | Entry | Component | Contents |
|---|---|---|---|
| `/` | `index.html` → `src/main-home.tsx` | `Home.tsx` | Hero (pill, `chrome-text` headline, Download/GitHub buttons, a static composer mock with pipeline-step chips, a static board mock), features grid, download section (macOS .dmg + run from source), "Built in the open" GitHub section |
| `/donate/` | `donate/index.html` → `src/main-donate.tsx` | `Donate.tsx` | Download banner (when `?download=1`), donation pitch, Stripe button, GitHub links |

- `Chrome.tsx`: shared `Container` and `Page` (the `app-backdrop` shell with a floating `metal-glass` nav, a theme toggle, and the footer). `Page` takes `home` (`'./'` or `'../'`) because every link is relative.
- The nav's Monitor / Sun / Moon toggle uses the dashboard's `@/theme` (`setTheme`/`useTheme`), so it shares the `orch:theme` key when served from the same origin.
- `boot.tsx` `mount()`: imports the Inter font and the dashboard CSS, calls `applyTheme()` from `@/theme`, and renders the page.
- The entry files are `main-*.tsx` on purpose: `home.tsx` next to `Home.tsx` collides on case-insensitive file systems (macOS), and tsc rejects it.
- `vite.config.ts` sets `base: './'`, so the build works from a sub-path too.

## Download → donate flow

1. Every Download button links to `./donate/?download=1`.
2. On mount, `Donate.tsx` sees `download=1` and sets `window.location.href = DOWNLOAD_URL` after 400 ms. A release asset is served as an attachment, so the browser downloads it and stays on the donate page. A **Retry download** button repeats this.
3. The Stripe button (gold variant, `shadow-gold-glow`, like Emergent's gold credits pill) opens `STRIPE_PAYMENT_LINK` in a new tab as "Support Kanbuild". While the link is empty, it renders disabled as "Donations coming soon".

## Config (`src/config.ts`)

| Constant | Source | Fallback |
|---|---|---|
| `DMG_URL` | `VITE_DMG_URL` at build time | `''` → `DOWNLOAD_URL` uses `RELEASES_URL` (GitHub releases/latest) |
| `STRIPE_PAYMENT_LINK` | `VITE_STRIPE_LINK` at build time | `https://donate.stripe.com/7sYaEYesE3lS5Ss9QPao805` (an empty value shows a disabled button) |
| `GITHUB_URL` | constant | — |

Set them either by editing the defaults in `config.ts` or at build time: `VITE_DMG_URL=… VITE_STRIPE_LINK=… npm run landing:build`.

## Design system reuse (no copies)

The look follows the dashboard's Emergent-inspired metallic system (reference: Emergent's home screen on Mobbin). It has a smoky/sky `app-backdrop`, a `chrome-text` headline, `metal-surface` cards, `metal-inset` wells, `metal-raised` chips, an accent primary button with `sheen`, `chrome` and `gold` buttons, and a cyan (dark) / blue (light) accent. The landing page defines no CSS of its own.

- The Vite alias `@` points at **`../web/src`**, and the tsconfig `paths` match. The landing page imports the dashboard's `@/components/ui/button`, `badge`, `progress`, `@/components/Logo`, `@/theme` and `@/lib/utils` directly. Those files import `@/lib/utils`, which resolves the same way.
- `@/index.css` (the zinc HSL tokens, `.dark`, radius) is imported in `boot.tsx` and processed with the landing page's own PostCSS/Tailwind config.
- `tailwind.config.js` uses the dashboard config as a `preset`, and its `content` includes `../web/src/components/**`. The preset brings the `gold` / `metal` colors and the `glow` / `gold-glow` shadows, so the classes used by shared components are generated.
- Changing a token or primitive in `web/` restyles both. Swapping `web/src/components/Logo.tsx` (and `web/src/assets/logo.png`) changes the logo everywhere.
- Favicons: `landing/public/favicon.png` and `apple-touch-icon.png` (copies of the dashboard's). They are linked relatively (`./` from home, `../` from `/donate/`) because of `base: './'`.

## Commands

```bash
npm run landing:dev       # http://127.0.0.1:5174
npm run landing:build     # → landing/dist (deploy this folder)
npm run landing:preview   # build, then serve dist on :4174
npm run typecheck         # includes the landing workspace
```

There are no tests. Verify it by building and opening `/` and `/donate/?download=1` at desktop and phone widths, in light and dark.
