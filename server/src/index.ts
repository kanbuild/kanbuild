import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { DATA_DIR, getDb } from './db.ts';
import { bus } from './events.ts';
import { orchestrator } from './orchestrator.ts';
import { setClientCounter } from './notify.ts';
import { api } from './routes/api.ts';
import type { ServerMessage } from '../../shared/types.ts';

const HOST = process.env.ORCH_HOST || '127.0.0.1';
const PORT = Number(process.env.ORCH_PORT || 4317);
const here = path.dirname(fileURLToPath(import.meta.url));
// ORCH_WEB_DIST lets a packaged install (the macOS app) point at its bundled dashboard.
const WEB_DIST = process.env.ORCH_WEB_DIST ? path.resolve(process.env.ORCH_WEB_DIST) : path.resolve(here, '../../web/dist');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
function isLocal(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '');
  return LOCAL_HOSTS.has(host);
}
function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (curl, scripts)
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname) || new URL(origin).hostname === '::1';
  } catch {
    return false;
  }
}

/** Warn when web/src is newer than the built dashboard (e.g. after git pull without `npm run build`). */
function warnIfDashboardStale() {
  const src = path.resolve(here, '../../web/src');
  const shared = path.resolve(here, '../../shared');
  try {
    const built = fs.statSync(path.join(WEB_DIST, 'index.html')).mtimeMs;
    const newest = (dir: string): number =>
      fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
        const p = path.join(dir, e.name);
        return Math.max(m, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
      }, 0);
    if (Math.max(newest(src), newest(shared)) > built) {
      console.warn('[orchestrator] WARNING: the dashboard build (web/dist) is older than its sources. Run `npm run build` (or `npm start`, which builds first).');
    }
  } catch {
    /* sources not present (packaged install) */
  }
}

getDb();
const app = express();
app.disable('x-powered-by');
// Guard against DNS rebinding and cross-site requests: only localhost hosts/origins are served.
app.use((req, res, next) => {
  if (!isLocal(req.headers.host) || !isLocalOrigin(req.headers.origin)) {
    res.status(403).json({ error: 'Forbidden: the orchestrator only accepts local requests' });
    return;
  }
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use('/api', api);

if (fs.existsSync(WEB_DIST)) {
  warnIfDashboardStale();
  // index.html must never be cached, or an old dashboard keeps loading after an update. Hashed assets can be.
  app.use(express.static(WEB_DIST, { index: false, setHeaders: (res, file) => file.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.type('text').send('Frontend not built. Run `npm run build` or use `npm run dev` (Vite on http://localhost:5173).'),
  );
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] !== '/ws' || !isLocal(req.headers.host) || !isLocalOrigin(req.headers.origin)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
setClientCounter(() => [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN).length);
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello' }));
});
bus.on('message', (msg: ServerMessage) => {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
});

server.listen(PORT, HOST, () => {
  console.log(`[orchestrator] listening on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  console.log(`[orchestrator] data directory: ${DATA_DIR}`);
  orchestrator.recover();
});

function shutdown() {
  // Agents are detached and keep running; they are re-attached on next start.
  console.log('[orchestrator] shutting down (running agents continue in the background)');
  orchestrator.shutdown();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
