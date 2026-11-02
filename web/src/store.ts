import { useSyncExternalStore } from 'react';
import type { AppNotification, Feature, Project, Run, RunEvent, ServerMessage, Settings } from '@shared/types.ts';
import { api, type SettingsResponse } from './api';

interface State {
  connected: boolean;
  projects: Project[];
  features: Record<string, Feature>;
  loadedProjects: Set<string>;
  settings: SettingsResponse | null;
}

let state: State = { connected: false, projects: [], features: {}, loadedProjects: new Set(), settings: null };
const listeners = new Set<() => void>();
const eventListeners = new Set<(e: RunEvent) => void>();
const runListeners = new Set<(r: Run) => void>();
const notificationListeners = new Set<(n: AppNotification) => void>();

export function onNotification(fn: (n: AppNotification) => void) {
  notificationListeners.add(fn);
  return () => {
    notificationListeners.delete(fn);
  };
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => selector(state),
  );
}

export function getState() {
  return state;
}

export function upsertFeature(f: Feature) {
  set({ features: { ...state.features, [f.id]: f } });
}

export function removeFeature(id: string) {
  const next = { ...state.features };
  delete next[id];
  set({ features: next });
}

export function upsertProject(p: Project) {
  const exists = state.projects.some((x) => x.id === p.id);
  set({ projects: exists ? state.projects.map((x) => (x.id === p.id ? p : x)) : [...state.projects, p] });
}

export async function loadProjects() {
  const [projects, settings] = await Promise.all([api.projects(), api.settings()]);
  set({ projects, settings });
  // Load every board so the sidebar can show what needs attention in other projects.
  await Promise.all(projects.filter((p) => !state.loadedProjects.has(p.id)).map((p) => loadFeatures(p.id).catch(() => {})));
}

export async function loadFeatures(projectId: string) {
  const list = await api.features(projectId);
  const features = { ...state.features };
  for (const [id, f] of Object.entries(features)) if (f.projectId === projectId) delete features[id];
  for (const f of list) features[f.id] = f;
  const loaded = new Set(state.loadedProjects);
  loaded.add(projectId);
  set({ features, loadedProjects: loaded });
}

export function setSettings(s: Settings) {
  set({ settings: { ...(state.settings as SettingsResponse), ...s } });
}

export function onRunEvent(fn: (e: RunEvent) => void) {
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}
export function onRunUpdate(fn: (r: Run) => void) {
  runListeners.add(fn);
  return () => {
    runListeners.delete(fn);
  };
}

function handle(msg: ServerMessage) {
  switch (msg.type) {
    case 'feature.updated':
      upsertFeature(msg.feature);
      break;
    case 'feature.deleted':
      removeFeature(msg.featureId);
      break;
    case 'run.updated': {
      const f = Object.values(state.features).find((x) => x.currentRunId === msg.run.id);
      if (f) upsertFeature({ ...f, run: msg.run, agentStatus: f.agentStatus });
      runListeners.forEach((l) => l(msg.run));
      break;
    }
    case 'run.event':
      eventListeners.forEach((l) => l(msg.event));
      break;
    case 'project.updated':
      upsertProject(msg.project);
      break;
    case 'project.deleted':
      set({ projects: state.projects.filter((p) => p.id !== msg.projectId) });
      break;
    case 'settings.updated':
      setSettings(msg.settings);
      break;
    case 'notification':
      notificationListeners.forEach((l) => l(msg.notification));
      break;
  }
}

/** Connect to the backend WebSocket with automatic reconnect; reloads state after reconnecting. */
export function connect() {
  let retry = 500;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 500;
      const wasConnected = state.connected;
      set({ connected: true });
      if (!wasConnected) {
        loadProjects().catch(() => {});
        for (const pid of state.loadedProjects) loadFeatures(pid).catch(() => {});
      }
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type !== 'hello') handle(msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      set({ connected: false });
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 8000);
    };
  };
  open();
}
