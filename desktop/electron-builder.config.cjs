// electron-builder config for the macOS app. See docs/desktop-app.md.
// Signing + notarization turn on when the Apple secrets are present (CI); otherwise the build is unsigned.
const path = require('node:path');

const canSign = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const canNotarize = canSign && Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
if (!canSign) console.warn('[electron-builder] no signing certificate (CSC_LINK): building an UNSIGNED app');
else if (!canNotarize) console.warn('[electron-builder] APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID missing: signed but NOT notarized');

const repo = path.resolve(__dirname, '..');

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.nelsonng2002.ai-orchestrator',
  productName: 'AI Orchestrator',
  copyright: 'Copyright (c) 2026 nelsonng2002. MIT License.',
  electronVersion: require('electron/package.json').version,
  directories: { output: 'release', buildResources: 'build' },
  // The main process is bundled; no node_modules are needed inside the app.
  files: ['dist/main.cjs', 'package.json'],
  npmRebuild: false,
  extraResources: [
    { from: path.join(repo, 'server', 'dist', 'server.mjs'), to: 'server/server.mjs' },
    { from: path.join(repo, 'web', 'dist'), to: 'web' },
    { from: 'vendor/node-${arch}', to: 'node', filter: ['bin/node', 'LICENSE'] },
    { from: path.join(repo, 'LICENSE'), to: 'LICENSE' },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.png',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // @electron/osx-sign walks the whole bundle, so the bundled Node (Resources/node/bin/node) is signed too,
    // with entitlementsInherit (it needs allow-jit under the hardened runtime).
    identity: canSign ? undefined : null,
    notarize: canNotarize,
    extendInfo: {
      NSAppleEventsUsageDescription: 'AI Orchestrator shows notifications and opens your editor via AppleScript.',
    },
  },
  dmg: { title: 'AI Orchestrator ${version}' },
  artifactName: 'AI-Orchestrator-${version}-${arch}.${ext}',
  publish: null,
};
