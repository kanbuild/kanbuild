# Landing page (`landing/`)

Source files: `landing/index.html`, `landing/donate/index.html`, `landing/src/*.tsx`, `landing/src/config.ts`, `landing/vite.config.ts`, `landing/tailwind.config.js`, `landing/package.json`

The public Kanbuild marketing site. It is a static, multi-page Vite + React + Tailwind app with no router and no backend. You host it yourself on any static host. It is **not** served by the Kanbuild backend.

## Pages

| URL | Entry | Component | Contents |
|---|---|---|---|
| `/` | `index.html` → `src/main-home.tsx` | `Home.tsx` | Nav, hero (headline, Download/GitHub buttons, static board mock), features grid, download section (macOS .dmg + run from source), "Built in the open" GitHub section, footer |
| `/donate/` | `donate/index.html` → `src/main-donate.tsx` | `Donate.tsx` | Download banner (when `?download=1`), donation pitch, Stripe button, GitHub links |

- `Chrome.tsx`: shared `Container`, `Nav` and `Footer`. They take `home` (`'./'` or `'../'`) because every link is relative.
- `boot.tsx` `mount()`: imports the dashboard CSS, applies the dark class from `prefers-color-scheme` (same rule as the dashboard), and renders the page.
- The entry files are `main-*.tsx` on purpose: `home.tsx` next to `Home.tsx` collides on case-insensitive file systems (macOS), and tsc rejects it.
- `vite.config.ts` sets `base: './'`, so the build works from a sub-path too.

## Download → donate flow

1. Every Download button links to `./donate/?download=1`.
2. On mount, `Donate.tsx` sees `download=1` and sets `window.location.href = DOWNLOAD_URL` after 400 ms. A release asset is served as an attachment, so the browser downloads it and stays on the donate page. A **Retry download** button repeats this.
3. The Stripe button opens `STRIPE_PAYMENT_LINK` in a new tab. While the link is empty, it renders disabled as "Donations coming soon".

## Config (`src/config.ts`)

| Constant | Source | Fallback |
|---|---|---|
| `DMG_URL` | `VITE_DMG_URL` at build time | `''` → `DOWNLOAD_URL` uses `RELEASES_URL` (GitHub releases/latest) |
| `STRIPE_PAYMENT_LINK` | `VITE_STRIPE_LINK` at build time | `''` → disabled button |
| `GITHUB_URL` | constant | — |

Set them either by editing the defaults in `config.ts` or at build time: `VITE_DMG_URL=… VITE_STRIPE_LINK=… npm run landing:build`.

## Design system reuse (no copies)

- The Vite alias `@` points at **`../web/src`**, and the tsconfig `paths` match. The landing page imports the dashboard's `@/components/ui/button`, `badge`, `progress`, `@/components/Logo` and `@/lib/utils` directly. Those files import `@/lib/utils`, which resolves the same way.
- `@/index.css` (the zinc HSL tokens, `.dark`, radius) is imported in `boot.tsx` and processed with the landing page's own PostCSS/Tailwind config.
- `tailwind.config.js` uses the dashboard config as a `preset`, and its `content` includes `../web/src/components/**`, so the classes used by shared components are generated.
- Changing a token or primitive in `web/` restyles both. Swapping `web/src/components/Logo.tsx` changes the logo everywhere.

## Commands

```bash
npm run landing:dev       # http://127.0.0.1:5174
npm run landing:build     # → landing/dist (deploy this folder)
npm run landing:preview   # build, then serve dist on :4174
npm run typecheck         # includes the landing workspace
```

There are no tests. Verify it by building and opening `/` and `/donate/?download=1` at desktop and phone widths, in light and dark.
