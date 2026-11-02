import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, Github } from 'lucide-react';
import type { AgentProfile, Effort, GithubStatus } from '@shared/types.ts';
import { api } from '@/api';
import { setSettings, useStore } from '@/store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, Input, Select } from './ui/input';
import { toast, toastError } from './toast';

function browserPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export const PROFILE_HELP: Record<AgentProfile, string> = {
  lean:
    'Recommended. Same Claude Code harness, with a smaller context per turn: only Read/Edit/Write/Glob/Grep/Bash, no skills or slash commands, no user MCP servers, and only the project’s own settings and CLAUDE.md (not ~/.claude).',
  full: 'Identical to an interactive session: all built-in tools, your skills, plugins, MCP servers, hooks and global ~/.claude/CLAUDE.md. Costs more tokens on every turn.',
};

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useStore((s) => s.settings);
  const [concurrency, setConcurrency] = useState(2);
  const [agentProfile, setAgentProfile] = useState<AgentProfile>('lean');
  const [effort, setEffort] = useState<Effort | ''>('medium');
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(0);
  const [defaultModel, setDefaultModel] = useState('');
  const [editorPreset, setEditorPreset] = useState('vscode');
  const [customEditor, setCustomEditor] = useState('');
  const [claudeBinary, setClaudeBinary] = useState('claude');
  const [notifications, setNotifications] = useState<'all' | 'attention' | 'off'>('all');
  const [systemNotifications, setSystemNotifications] = useState(false);
  const [permission, setPermission] = useState(browserPermission());
  const [github, setGithub] = useState<(GithubStatus & { error?: string }) | null>(null);
  const [token, setToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);

  const presets = settings?.editorPresets ?? [];

  useEffect(() => {
    if (open && settings) {
      setConcurrency(settings.concurrency);
      setAgentProfile(settings.agentProfile);
      setEffort(settings.effort);
      setMaxBudgetUsd(settings.maxBudgetUsd);
      setDefaultModel(settings.defaultModel);
      const isPreset = settings.editorPresets.some((p) => p.id === settings.editorCommand) || settings.editorCommand === 'code';
      setEditorPreset(isPreset ? (settings.editorCommand === 'code' ? 'vscode' : settings.editorCommand) : 'custom');
      setCustomEditor(isPreset ? '' : settings.editorCommand);
      setClaudeBinary(settings.claudeBinary);
      setNotifications(settings.notifications);
      setSystemNotifications(settings.systemNotifications);
      setPermission(browserPermission());
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    setToken('');
    setGithub(settings?.github ?? null);
    api.githubStatus().then(setGithub).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const saveToken = async (value: string) => {
    setSavingToken(true);
    try {
      const s = await api.setGithubToken(value);
      setGithub(s);
      setToken('');
      setSettings({ ...(settings as any), github: s });
      toast(value ? `GitHub connected as @${s.login}` : 'GitHub token removed');
    } catch (err) {
      toastError(err);
    } finally {
      setSavingToken(false);
    }
  };

  const enableBrowser = async () => {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const editorCommand = editorPreset === 'custom' ? customEditor.trim() : editorPreset;
      setSettings(await api.updateSettings({ concurrency, agentProfile, effort, maxBudgetUsd, defaultModel, editorCommand, claudeBinary, notifications, systemNotifications }));
      onOpenChange(false);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Defaults for all projects. Projects can override the agent profile, effort and model.</DialogDescription>
          </DialogHeader>
          <Field label="Agent profile" hint={PROFILE_HELP[agentProfile]}>
            <Select value={agentProfile} onChange={(e) => setAgentProfile(e.target.value as AgentProfile)}>
              <option value="lean">Lean (lower token use)</option>
              <option value="full">Full (same as interactive Claude Code)</option>
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Effort" hint="claude --effort">
              <Select value={effort} onChange={(e) => setEffort(e.target.value as Effort | '')}>
                <option value="">Claude Code default</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
                <option value="max">max</option>
              </Select>
            </Field>
            <Field label="Budget per run (USD)" hint="Hard stop (--max-budget-usd). 0 = none.">
              <Input type="number" min={0} step={0.5} value={maxBudgetUsd} onChange={(e) => setMaxBudgetUsd(Number(e.target.value))} />
            </Field>
            <Field label="Max concurrent agents" hint="Others wait in a queue.">
              <Input type="number" min={1} max={16} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Default model" hint="Used when a project has no model override. Empty = Claude Code default (e.g. opus, sonnet).">
            <Input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="default" className="font-mono text-xs" />
          </Field>
          <Field label="Editor" hint="Used by “Open in editor”. If the editor’s CLI isn’t on PATH, macOS apps are opened with `open -a`.">
            <div className="flex gap-2">
              <Select value={editorPreset} onChange={(e) => setEditorPreset(e.target.value)} className="w-56">
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Custom command…</option>
              </Select>
              {editorPreset === 'custom' && (
                <Input value={customEditor} onChange={(e) => setCustomEditor(e.target.value)} placeholder="/usr/local/bin/subl -n" className="font-mono text-xs" />
              )}
            </div>
          </Field>
          <Field label="Claude Code binary">
            <Input value={claudeBinary} onChange={(e) => setClaudeBinary(e.target.value)} className="font-mono text-xs" />
          </Field>
          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
              <Bell className="h-3.5 w-3.5" /> Notifications
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={notifications} onChange={(e) => setNotifications(e.target.value as typeof notifications)} className="w-64">
                <option value="all">Everything (checkpoints, failures, done, PRs)</option>
                <option value="attention">Only when I need to act (checkpoints, failures)</option>
                <option value="off">Off</option>
              </Select>
              {permission === 'granted' ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Browser notifications on
                </span>
              ) : permission === 'unsupported' ? (
                <span className="text-xs text-muted-foreground">Browser notifications unsupported</span>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={enableBrowser} disabled={permission === 'denied'}>
                  {permission === 'denied' ? 'Blocked in browser settings' : 'Enable browser notifications'}
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => api.testNotification().catch(toastError)}>
                Send test
              </Button>
            </div>
            {settings?.platform === 'darwin' && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={systemNotifications} onChange={(e) => setSystemNotifications(e.target.checked)} />
                macOS notifications when no dashboard tab is open
              </label>
            )}
            <p className="text-[11px] text-muted-foreground">Shown as a desktop notification when this tab is in the background, otherwise as a toast.</p>
          </fieldset>
          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
              <Github className="h-3.5 w-3.5" /> GitHub
            </legend>
            {github?.configured ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Connected{github.login ? ` as @${github.login}` : ''}
                </span>
                <span className="text-muted-foreground">({github.source === 'env' ? 'from ORCH_GITHUB_TOKEN' : 'token stored with 0600 permissions in the data directory'})</span>
                {github.error && <span className="text-red-600">{github.error}</span>}
                {github.source === 'file' && (
                  <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => saveToken('')} disabled={savingToken}>
                    Remove token
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Not connected. Add a token to create pull requests.</p>
            )}
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_… or ghp_…" className="font-mono text-xs" />
              <Button type="button" size="sm" variant="outline" onClick={() => saveToken(token)} disabled={!token.trim() || savingToken}>
                {github?.configured ? 'Replace' : 'Save token'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Fine-grained token with <strong>Contents: read &amp; write</strong> and <strong>Pull requests: read &amp; write</strong> on your repositories. It is validated, never shown again, never passed to agents, and only used to push feature branches and open pull requests. Nothing is ever merged.
            </p>
          </fieldset>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
