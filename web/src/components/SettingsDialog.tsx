import { useEffect, useState } from 'react';
import type { AgentProfile, Effort } from '@shared/types.ts';
import { api } from '@/api';
import { setSettings, useStore } from '@/store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, Input, Select } from './ui/input';
import { toastError } from './toast';

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
    }
  }, [open, settings]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const editorCommand = editorPreset === 'custom' ? customEditor.trim() : editorPreset;
      setSettings(await api.updateSettings({ concurrency, agentProfile, effort, maxBudgetUsd, defaultModel, editorCommand, claudeBinary }));
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
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
