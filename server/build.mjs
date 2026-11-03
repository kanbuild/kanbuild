// Bundle the backend into one ESM file (server/dist/server.mjs) for packaged installs such as the macOS app.
// Dev and `npm start` keep running the TypeScript sources directly with tsx.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  // ws loads these optional native addons only if they are installed.
  external: ['bufferutil', 'utf-8-validate'],
  // CommonJS dependencies (express) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __orchCreateRequire } from 'node:module'; const require = __orchCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
