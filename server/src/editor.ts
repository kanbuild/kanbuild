import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface EditorPreset {
  id: string;
  label: string;
  /** CLI command names to look for on PATH / well-known locations. */
  commands: string[];
  /** macOS application name for `open -a`. */
  macApp?: string;
  /** Extra absolute paths to try (e.g. CLI shipped inside the app bundle). */
  paths?: string[];
}

export const EDITOR_PRESETS: EditorPreset[] = [
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    commands: ['code'],
    macApp: 'Visual Studio Code',
    paths: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
  },
  { id: 'cursor', label: 'Cursor', commands: ['cursor'], macApp: 'Cursor', paths: ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor'] },
  { id: 'zed', label: 'Zed', commands: ['zed'], macApp: 'Zed' },
  { id: 'webstorm', label: 'WebStorm', commands: ['webstorm'], macApp: 'WebStorm' },
  { id: 'intellij', label: 'IntelliJ IDEA', commands: ['idea'], macApp: 'IntelliJ IDEA' },
  { id: 'finder', label: process.platform === 'darwin' ? 'Finder' : 'File manager', commands: [] },
];

const EXTRA_BIN_DIRS = ['/usr/local/bin', '/opt/homebrew/bin', path.join(process.env.HOME || '', '.local/bin')];

/** Find an executable on PATH or in common install locations (a backend started outside a shell has a minimal PATH). */
export function findExecutable(cmd: string, extraPaths: string[] = []): string | null {
  if (cmd.includes('/')) return isExecutable(cmd) ? cmd : null;
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...EXTRA_BIN_DIRS].filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, cmd);
    if (isExecutable(p)) return p;
  }
  for (const p of extraPaths) if (path.basename(p) === cmd && isExecutable(p)) return p;
  return null;
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function macAppExists(app: string): boolean {
  return ['/Applications', path.join(process.env.HOME || '', 'Applications')].some((d) => fs.existsSync(path.join(d, `${app}.app`)));
}

export interface ResolvedCommand {
  bin: string;
  args: string[];
  description: string;
}

export class EditorError extends Error {}

/**
 * Work out how to open `target` for an editor setting, which is either a preset id ("vscode")
 * or a custom command line ("code -n", "/path/to/editor").
 */
export function resolveEditorCommand(setting: string, target: string, platform: NodeJS.Platform = process.platform): ResolvedCommand {
  const value = (setting || 'vscode').trim();
  const preset = EDITOR_PRESETS.find((p) => p.id === value) ?? EDITOR_PRESETS.find((p) => p.commands[0] === value.split(/\s+/)[0]);

  if (preset?.id === 'finder' || value === 'finder') return revealCommand(target, platform);

  if (preset && (preset.id === value || value === preset.commands[0])) {
    for (const cmd of preset.commands) {
      const found = findExecutable(cmd, preset.paths);
      if (found) return { bin: found, args: [target], description: `${preset.label} (${found})` };
    }
    for (const p of preset.paths ?? []) if (isExecutable(p)) return { bin: p, args: [target], description: `${preset.label} (${p})` };
    if (platform === 'darwin' && preset.macApp && macAppExists(preset.macApp)) {
      return { bin: 'open', args: ['-a', preset.macApp, target], description: `${preset.label} (open -a)` };
    }
    throw new EditorError(
      `${preset.label} was not found. ${
        preset.id === 'vscode' || preset.id === 'cursor'
          ? `Install the \`${preset.commands[0]}\` command (in ${preset.label}: Command Palette → "Shell Command: Install '${preset.commands[0]}' command in PATH"), or choose another editor in Settings.`
          : 'Choose another editor in Settings.'
      }`,
    );
  }

  // Custom command line.
  const [cmd, ...rest] = value.split(/\s+/).filter(Boolean);
  const found = findExecutable(cmd);
  if (found) return { bin: found, args: [...rest, target], description: found };
  if (platform === 'darwin' && macAppExists(value)) return { bin: 'open', args: ['-a', value, target], description: `${value} (open -a)` };
  throw new EditorError(`Editor command "${cmd}" was not found on PATH. Use an absolute path or choose a preset in Settings.`);
}

export function revealCommand(target: string, platform: NodeJS.Platform = process.platform): ResolvedCommand {
  if (platform === 'darwin') return { bin: 'open', args: [target], description: 'Finder' };
  if (platform === 'win32') return { bin: 'explorer', args: [target], description: 'Explorer' };
  return { bin: 'xdg-open', args: [target], description: 'file manager' };
}

/** Launch a command detached and resolve once it has started (or reject with a readable error). */
export function launch(cmd: ResolvedCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.bin, cmd.args, { detached: true, stdio: 'ignore' });
    child.once('error', (e) => reject(new EditorError(`Could not launch ${cmd.description}: ${e.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Open a new Terminal.app window running `command` (macOS only). */
export function openTerminalCommand(command: string, platform: NodeJS.Platform = process.platform): ResolvedCommand {
  if (platform !== 'darwin') throw new EditorError('Opening a terminal is only supported on macOS. Copy the command instead.');
  return {
    bin: 'osascript',
    args: ['-e', `tell application "Terminal" to do script ${appleScriptString(command)}`, '-e', 'tell application "Terminal" to activate'],
    description: 'Terminal',
  };
}
