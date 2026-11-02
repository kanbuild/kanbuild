import { execFile } from 'node:child_process';
import { newId, now } from './db.ts';
import { appleScriptString } from './editor.ts';
import { bus } from './events.ts';
import { getSettings } from './settings.ts';
import type { AppNotification } from '../../shared/types.ts';

let countClients: () => number = () => 0;

/** The WebSocket layer registers how many dashboard tabs are connected. */
export function setClientCounter(fn: () => number) {
  countClients = fn;
}

/** osascript arguments for a macOS notification banner. */
export function systemNotificationArgs(title: string, body: string): string[] {
  return ['-e', `display notification ${appleScriptString(body.slice(0, 240))} with title ${appleScriptString('AI Orchestrator')} subtitle ${appleScriptString(title.slice(0, 120))}`];
}

export function shouldNotify(mode: 'all' | 'attention' | 'off', level: AppNotification['level']): boolean {
  if (mode === 'off') return false;
  if (mode === 'attention') return level === 'attention' || level === 'error';
  return true;
}

/**
 * Notify the user: dashboard tabs show a browser notification (or a toast when visible). When no tab is
 * open, fall back to a macOS notification so approvals and failures are not missed.
 */
export function notify(n: Omit<AppNotification, 'id' | 'ts'>): AppNotification | null {
  const settings = getSettings();
  if (!shouldNotify(settings.notifications, n.level)) return null;
  const notification: AppNotification = { ...n, id: newId('ntf'), ts: now() };
  bus.publish({ type: 'notification', notification });
  if (settings.systemNotifications && process.platform === 'darwin' && countClients() === 0) {
    execFile('osascript', systemNotificationArgs(n.title, n.body), () => {
      /* best effort */
    });
  }
  return notification;
}
