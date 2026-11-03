// Fill these in (or set VITE_DMG_URL / VITE_STRIPE_LINK at build time).
// Empty values fall back gracefully: downloads go to the GitHub releases page,
// and the donate button shows "Donations coming soon".

export const GITHUB_URL = 'https://github.com/nelsonng2002/autonomous-feature-agent';
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`;

/** Direct link to the macOS .dmg (e.g. a GitHub release asset URL). */
export const DMG_URL: string = import.meta.env.VITE_DMG_URL || '';

/** Stripe Payment Link (https://buy.stripe.com/...). */
export const STRIPE_PAYMENT_LINK: string = import.meta.env.VITE_STRIPE_LINK || '';

export const DOWNLOAD_URL = DMG_URL || RELEASES_URL;
