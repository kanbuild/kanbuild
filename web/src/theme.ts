import { useSyncExternalStore } from 'react';

/** 'system' follows the OS `prefers-color-scheme`; the choice is stored in localStorage `orch:theme`. */
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'orch:theme';
const subs = new Set<() => void>();
let current: Theme = read();
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function paint() {
  const dark = current === 'dark' || (current === 'system' && !!media?.matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Call once at startup: applies the stored theme and follows OS changes while in 'system' mode. */
export function applyTheme() {
  paint();
  media?.addEventListener('change', () => {
    if (current === 'system') paint();
  });
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(t: Theme) {
  current = t;
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  paint();
  subs.forEach((s) => s());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getTheme,
  );
}
