# Landing page (`landing/`)

Source files: `landing/index.html`, `landing/donate/index.html`, `landing/getting-started/index.html`, `landing/scripts/*.mjs`, `landing/src/*.tsx`, `landing/src/config.ts`, `landing/vite.config.ts`, `landing/tailwind.config.js`, `landing/package.json`, `landing/public/*`

The public Kanbuild marketing site. It is a static, multi-page Vite + React + Tailwind app with no router and no backend. You host it yourself on any static host. It is **not** served by the Kanbuild backend.

## Pages

| URL | Entry | Component | Contents |
|---|---|---|---|
| `/` | `index.html` → `src/main-home.tsx` | `Home.tsx` | Hero (pill, `chrome-text` headline "Drag a card. Ship a build.", Download/GitHub buttons, a getting-started link), then the **board** as the focal point: `BoardMock` (Backlog/Build/Done with running, gated and done cards) and `AgentSheetMock` (the running card's detail sheet: badges, pipeline step chain, progress, tab strip, live activity rows, stats) overlapping the board's bottom edge with a "Open a card to watch its agent work" caption. Then the features grid, download section (macOS .dmg + run from source + a "Read the getting started guide" button), "Built in the open" GitHub section |
| `/getting-started/` | `getting-started/index.html` → `src/main-getting-started.tsx` | `GettingStarted.tsx` | Step-by-step guide: prerequisites, install, add a project, pipeline, add a feature, Build and watch, checkpoints, review, **GitHub personal access token** (fine-grained: Contents + Pull requests read/write), global settings, fake-CLI demo, troubleshooting. A sticky step list on lg. Real app screenshots via `Shot` |
| `/donate/` | `donate/index.html` → `src/main-donate.tsx` | `Donate.tsx` | Download banner (when `?download=1`), donation pitch, Stripe button, GitHub links |

- The mocks on the home page are JSX (theme-aware, reusing `Badge`/`Progress`/`metal-*`), not images. Keep their names and numbers consistent with the screenshots' demo board.
- `Chrome.tsx`: shared `Container` and `Page` (the `app-backdrop` shell with a floating `metal-glass` nav (Features, Get started, Download; hidden below `sm`), a theme toggle, and the footer). `Page` takes `home` (`'./'` or `'../'`) because every link is relative.
- The nav's Monitor / Sun / Moon toggle uses the dashboard's `@/theme` (`setTheme`/`useTheme`), so it shares the `orch:theme` key when served from the same origin.
- `boot.tsx` `mount()`: imports the Inter font and the dashboard CSS, calls `applyTheme()` from `@/theme`, and renders the page.
- The entry files are `main-*.tsx` on purpose: `home.tsx` next to `Home.tsx` collides on case-insensitive file systems (macOS), and tsc rejects it.
- `vite.config.ts` sets `base: './'`, so the build works from a sub-path too.

## Getting Started guide and screenshots

- `GettingStarted.tsx` holds the steps in a `STEPS` array (`id`, `title`, JSX `body`). The `id` is the anchor used by the sticky step list. Body typography comes from the `PROSE` class string (Tailwind arbitrary variants, since the landing page defines no CSS). Links inside `p`/`li`/`dd` get the accent color; `Button` links keep theirs.
- `Shot name=… [narrow|small]` renders `screenshots/<name>.light.jpg` and `<name>.dark.jpg` and shows the one matching the theme (`dark:hidden` / `hidden dark:block`), lazy-loaded.
- Screenshots are **real** dashboard captures in `landing/public/screenshots/` (13 scenes × light/dark, JPEG q82, 2× scale, ~4.6 MB). Regenerate them after UI changes:

```bash
npm run build                                  # the dashboard (web/dist)
node landing/scripts/screenshots.mjs           # all scenes
node landing/scripts/screenshots.mjs board changes   # only these scenes (the board is still seeded)
```

  `screenshots.mjs` needs Playwright with Chromium installed globally (it is not a project dependency). It creates a throwaway `acme-web` git repo in a temp dir, a stub GitHub API (`GET /user` → `octocat`, so Settings shows a connected token), and starts the backend on port **4399** with a temp `ORCH_DATA_DIR` and `ORCH_CLAUDE_BIN=landing/scripts/slow-claude.mjs`. It seeds a project and features through the REST API, drives gates to get done / plan-approval / final-approval cards, then captures each scene at 1440×900.
- `slow-claude.mjs` wraps the fake CLI (`server/test/fixtures/fake-claude.mjs`): the developer run whose worktree matches `reports-api` stops forwarding output right before its `Bash npm test` step and stays alive, so the "Reports API" card is reliably **running**. Everything else runs fast (60 ms steps).
- The `settings` scene types `claude` into the Claude binary field (not saved) so the wrapper path doesn't appear.

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

There are no tests. Verify it by building and opening `/`, `/getting-started/` and `/donate/?download=1` at desktop and phone widths, in light and dark (no horizontal scroll, screenshots load through relative `../screenshots/` paths).
