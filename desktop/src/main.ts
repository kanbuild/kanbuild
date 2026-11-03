/**
 * Electron main process for the macOS app.
 *
 * The app is a thin shell around the existing backend + dashboard:
 *   1. resolve the user's login-shell PATH (GUI apps start with a minimal PATH, so `claude`/`git` would be missing),
 *   2. reuse an orchestrator that is already listening (e.g. `npm start`), or spawn the bundled backend,
 *   3. load http://localhost:<port> in a window.
 * Quitting stops the backend we started; agents are detached and keep running (the backend reattaches on next start).
 * See docs/desktop-app.md.
 */
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBackendEnv, isLocalUrl, parseMarkedPath, withFallbackPath } from './env.ts';

const PORT = Number(process.env.ORCH_PORT || 4317);
const BASE_URL = `http://localhost:${PORT}`;
const PROBE_URL = `http://127.0.0.1:${PORT}/api/settings`;
const LOG_DIR = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Logs', 'Kanbuild') : path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');

let backend: ChildProcess | null = null;
let quitting = false;
let mainWindow: BrowserWindow | null = null;

/** Where the bundled pieces live: inside the .app when packaged, the repo checkout in development. */
function resources() {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return {
      node: path.join(res, 'node', 'bin', 'node'),
      server: path.join(res, 'server', 'server.mjs'),
      web: path.join(res, 'web'),
    };
  }
  const repo = path.resolve(__dirname, '..', '..');
  return {
    node: process.env.ORCH_NODE_BIN || 'node',
    server: path.join(repo, 'server', 'dist', 'server.mjs'),
    web: path.join(repo, 'web', 'dist'),
  };
}

/** The PATH an interactive login shell would have (Homebrew, nvm, ~/.local/bin, where `claude` usually lives). */
function loginShellPath(): Promise<string> {
  const fallback = withFallbackPath(process.env.PATH, os.homedir());
  if (process.platform !== 'darwin') return Promise.resolve(process.env.PATH || fallback);
  const shellBin = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    execFile(shellBin, ['-ilc', 'printf "__ORCH_PATH__%s__ORCH_PATH__" "$PATH"'], { timeout: 8000, env: process.env }, (_err, stdout) => {
      const found = parseMarkedPath(String(stdout ?? ''));
      resolve(found ? withFallbackPath(found, os.homedir()) : fallback);
    });
  });
}

type Probe = { kind: 'orchestrator'; apiVersion: number } | { kind: 'other' } | { kind: 'none' };

async function probe(): Promise<Probe> {
  try {
    const res = await fetch(PROBE_URL, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { kind: 'other' };
    const body = (await res.json()) as { apiVersion?: unknown };
    return typeof body.apiVersion === 'number' ? { kind: 'orchestrator', apiVersion: body.apiVersion } : { kind: 'other' };
  } catch (err) {
    // Something is listening but did not answer like the orchestrator (non-JSON, timeout, reset).
    if (err instanceof SyntaxError) return { kind: 'other' };
    const name = (err as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'other' };
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return !code || code === 'ECONNREFUSED' ? { kind: 'none' } : { kind: 'other' };
  }
}

async function waitForBackend(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!backend || backend.exitCode !== null) return false;
    if ((await probe()).kind === 'orchestrator') return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startBackend(): Promise<void> {
  const res = resources();
  if (!fs.existsSync(res.server)) throw new Error(`Backend bundle not found at ${res.server}. Run \`npm run build:server\`.`);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.openSync(LOG_FILE, 'a');
  fs.writeSync(log, `\n==== ${new Date().toISOString()} starting backend (${app.getName()} ${app.getVersion()}) ====\n`);
  const env = buildBackendEnv(process.env, { path: await loginShellPath(), webDist: res.web, port: PORT });
  backend = spawn(res.node, [res.server], { env, stdio: ['ignore', log, log], cwd: os.homedir() });
  fs.closeSync(log);
  backend.once('exit', (code, signal) => {
    const wasRunning = backend !== null;
    backend = null;
    if (!quitting && wasRunning) void onBackendCrash(code, signal);
  });
  backend.once('error', () => {
    /* surfaced via waitForBackend / exit */
  });
  if (!(await waitForBackend(30_000))) {
    throw new Error('The backend did not start.');
  }
}

async function onBackendCrash(code: number | null, signal: NodeJS.Signals | null) {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    message: 'The orchestrator backend stopped unexpectedly.',
    detail: `Exit ${code ?? signal}. Running agents are not affected. Log: ${LOG_FILE}`,
    buttons: ['Restart', 'Show Log', 'Quit'],
    defaultId: 0,
  });
  if (response === 0) {
    try {
      await startBackend();
      mainWindow?.reload();
    } catch (err) {
      fatal(err);
    }
  } else if (response === 1) {
    shell.showItemInFolder(LOG_FILE);
    app.quit();
  } else {
    app.quit();
  }
}

function fatal(err: unknown) {
  dialog.showErrorBox('Kanbuild could not start', `${err instanceof Error ? err.message : String(err)}\n\nLog: ${LOG_FILE}`);
  app.exit(1);
}

// ---- Window ----

const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
type Bounds = { x?: number; y?: number; width: number; height: number };
function loadBounds(): Bounds {
  try {
    const b = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) as Bounds;
    if (b.width > 400 && b.height > 300) return b;
  } catch {
    /* first launch */
  }
  return { width: 1440, height: 900 };
}

function createWindow() {
  const win = new BrowserWindow({
    ...loadBounds(),
    minWidth: 900,
    minHeight: 600,
    title: 'Kanbuild',
    backgroundColor: '#0b0c0e',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Links to GitHub, docs, etc. open in the default browser; only the dashboard itself stays in the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalUrl(url, PORT)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocalUrl(url, PORT)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.on('close', () => {
    try {
      fs.writeFileSync(STATE_FILE(), JSON.stringify(win.getBounds()));
    } catch {
      /* best effort */
    }
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(BASE_URL);
  mainWindow = win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Open in Browser', click: () => void shell.openExternal(BASE_URL) },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Project on GitHub', click: () => void shell.openExternal('https://github.com/nelsonng2002/autonomous-feature-agent') },
        { label: 'Show Backend Log', click: () => shell.showItemInFolder(LOG_FILE) },
        { label: 'Open Data Folder', click: () => void shell.openPath(process.env.ORCH_DATA_DIR || path.join(os.homedir(), '.local-orchestrator')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Lifecycle ----

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) createWindow();
    else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      const existing = await probe();
      if (existing.kind === 'other') {
        throw new Error(`Port ${PORT} is already in use by another program. Quit it, or set ORCH_PORT.`);
      }
      // kind 'orchestrator': reuse it (e.g. `npm start` in a terminal) so two backends never schedule agents on one DB.
      if (existing.kind === 'none') await startBackend();
    } catch (err) {
      fatal(err);
      return;
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }, fatal);

  // On macOS closing the window keeps the app (and the pipelines) running in the Dock.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    quitting = true;
    const child = backend;
    if (!child || child.exitCode !== null) return;
    event.preventDefault();
    backend = null;
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(force);
      app.quit();
    });
    child.kill('SIGTERM'); // the backend stops tails/timers and validations; agents keep running
  });
}
