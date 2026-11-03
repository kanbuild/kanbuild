// Download the pinned official Node.js runtime that the macOS app bundles to run the backend.
// The backend needs node:sqlite (Node >= 22.13), so the app does not rely on Node being installed.
// Output: desktop/vendor/node-<arch>/bin/node (+ LICENSE). Archs: arm64 and x64, or ORCH_NODE_ARCHS="arm64".
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = 'v22.23.4';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archs = (process.env.ORCH_NODE_ARCHS || 'arm64,x64').split(',').map((s) => s.trim()).filter(Boolean);
const base = `https://nodejs.org/dist/${NODE_VERSION}`;

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sums = (await get(`${base}/SHASUMS256.txt`)).toString('utf8');
for (const arch of archs) {
  const name = `node-${NODE_VERSION}-darwin-${arch}`;
  const out = path.join(root, 'vendor', `node-${arch}`);
  const marker = path.join(out, '.version');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === NODE_VERSION) {
    console.log(`[fetch-node] ${name} already present`);
    continue;
  }
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${name}.tar.gz`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`no checksum for ${name}.tar.gz`);
  console.log(`[fetch-node] downloading ${name}.tar.gz`);
  const tarball = await get(`${base}/${name}.tar.gz`);
  const actual = createHash('sha256').update(tarball).digest('hex');
  if (actual !== expected) throw new Error(`checksum mismatch for ${name}: ${actual} != ${expected}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-node-'));
  try {
    const file = path.join(tmp, `${name}.tar.gz`);
    fs.writeFileSync(file, tarball);
    execFileSync('tar', ['-xzf', file, '-C', tmp, `${name}/bin/node`, `${name}/LICENSE`]);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, 'bin'), { recursive: true });
    fs.copyFileSync(path.join(tmp, name, 'bin', 'node'), path.join(out, 'bin', 'node'));
    fs.chmodSync(path.join(out, 'bin', 'node'), 0o755);
    fs.copyFileSync(path.join(tmp, name, 'LICENSE'), path.join(out, 'LICENSE'));
    fs.writeFileSync(marker, NODE_VERSION);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`[fetch-node] ${name} ready (sha256 verified)`);
}
