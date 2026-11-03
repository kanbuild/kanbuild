// Fill these in (or set VITE_DMG_URL / VITE_STRIPE_LINK at build time).
// An empty DMG_URL sends downloads to the GitHub releases page.

export const GITHUB_URL = 'https://github.com/nelsonng2002/autonomous-feature-agent';
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`;

/** Direct link to the macOS .dmg (e.g. a GitHub release asset URL). */
export const DMG_URL: string = import.meta.env.VITE_DMG_URL || '';

/** Stripe Payment Link. VITE_STRIPE_LINK overrides it at build time. */
export const STRIPE_PAYMENT_LINK: string = import.meta.env.VITE_STRIPE_LINK || 'https://donate.stripe.com/7sYaEYesE3lS5Ss9QPao805';

export const DOWNLOAD_URL = DMG_URL || RELEASES_URL;
