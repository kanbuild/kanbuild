import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { PathValidation, Project } from '@shared/types.ts';
import { api, type LaunchPreview } from '@/api';
import { PROFILE_HELP } from './SettingsDialog';
import { upsertProject, useStore } from '@/store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, Input, Select, Textarea } from './ui/input';
import { toastError } from './toast';

const NO_TOOLS: string[] = [];

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project?: Project | null;
  onSaved?: (p: Project) => void;
}) {
  const defaults = useStore((s) => s.settings?.defaultAllowedTools ?? NO_TOOLS);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [worktreeRoot, setWorktreeRoot] = useState('');
  const [model, setModel] = useState('');
  const [tools, setTools] = useState('');
  const [agentProfile, setAgentProfile] = useState('');
  const [effort, setEffort] = useState('');
  const [mcpConfig, setMcpConfig] = useState('');
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [validation, setValidation] = useState<PathValidation | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPath(project?.path ?? '');
    setName(project?.name ?? '');
    setDescription(project?.description ?? '');
    setBaseBranch(project?.baseBranch ?? '');
    setWorktreeRoot(project?.worktreeRoot ?? '');
    setModel(project?.model ?? '');
    setTools((project?.allowedTools ?? defaults).join('\n'));
    setAgentProfile(project?.agentProfile ?? '');
    setEffort(project?.effort ?? '');
    setMcpConfig(project?.mcpConfig ?? '');
    setPreview(null);
    setShowPrompt(false);
    if (project) api.launchPreview(project.id).then(setPreview).catch(() => {});
    setValidation(null);
    if (project) api.validatePath(project.path).then(setValidation).catch(() => {});
  }, [open, project, defaults]);

  // Validate path as the user types (debounced).
  useEffect(() => {
    if (!open || project || !path.trim()) return;
    const t = setTimeout(async () => {
      try {
        const v = await api.validatePath(path);
        setValidation(v);
        if (v.isGitRepo) {
          setName((n) => n || v.suggestedName);
          setBaseBranch((b) => (b && v.branches.includes(b) ? b : v.currentBranch || v.branches[0] || ''));
          setWorktreeRoot((w) => w || v.suggestedWorktreeRoot);
        }
      } catch {
        /* ignore */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [path, open, project]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const input = {
      name,
      description,
      baseBranch,
      worktreeRoot,
      model,
      agentProfile,
      effort,
      mcpConfig,
      allowedTools: tools.split('\n').map((t) => t.trim()).filter(Boolean),
    };
    try {
      const p = project ? await api.updateProject(project.id, input) : await api.createProject({ ...input, path });
      upsertProject(p);
      onSaved?.(p);
      onOpenChange(false);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const valid = project || (validation?.isGitRepo && validation.isWorktreeRoot && validation.branches.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{project ? 'Project settings' : 'Add project'}</DialogTitle>
            <DialogDescription>Register an existing local Git repository. Nothing in the repository is modified.</DialogDescription>
          </DialogHeader>
          <Field
            label="Repository path"
            hint={
              validation && (
                <span className={`inline-flex items-center gap-1 ${valid ? 'text-emerald-600' : 'text-red-600'}`}>
                  {valid ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {valid ? `Git repository · ${validation.branches.length} branch(es)` : validation.error}
                </span>
              )
            }
          >
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Projects/Tiles" disabled={!!project} className="font-mono text-xs" required />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tiles" />
            </Field>
            <Field label="Base branch" hint="Worktrees are created from this branch">
              <Select value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)}>
                {(validation?.branches ?? (baseBranch ? [baseBranch] : [])).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          <Field label="Worktree directory" hint="Each feature gets its own subdirectory here, e.g. Tiles-worktrees/feature-onboarding">
            <Input value={worktreeRoot} onChange={(e) => setWorktreeRoot(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field label="Model (optional)" hint="Passed to `claude --model`, e.g. opus, sonnet, claude-sonnet-5-5. Empty = Claude Code default.">
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" className="font-mono text-xs" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Agent profile" hint={agentProfile ? PROFILE_HELP[agentProfile as 'lean' | 'full'] : 'Uses the global setting.'}>
              <Select value={agentProfile} onChange={(e) => setAgentProfile(e.target.value)}>
                <option value="">Use global setting</option>
                <option value="lean">Lean</option>
                <option value="full">Full</option>
              </Select>
            </Field>
            <Field label="Effort" hint="Overrides the global effort.">
              <Select value={effort} onChange={(e) => setEffort(e.target.value)}>
                <option value="">Use global setting</option>
                {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="MCP config (optional)" hint="JSON or a file path for `claude --mcp-config`. With the lean profile, only these MCP servers are loaded.">
            <Input value={mcpConfig} onChange={(e) => setMcpConfig(e.target.value)} placeholder=".mcp.json" className="font-mono text-xs" />
          </Field>
          <Field
            label="Allowed tools (one per line)"
            hint="Passed to `claude --allowedTools`. Agents run with --permission-mode acceptEdits; anything not listed is denied (no unrestricted permissions)."
          >
            <Textarea value={tools} onChange={(e) => setTools(e.target.value)} rows={8} className="font-mono text-xs" />
          </Field>
          {preview && (
            <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
              <div className="text-xs font-medium text-muted-foreground">How agents are launched (saved settings)</div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{preview.command}</pre>
              <button type="button" className="text-[11px] text-sky-600 hover:underline" onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? 'Hide' : 'Show'} the feature prompt template
              </button>
              {showPrompt && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px]">{preview.prompt}</pre>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !valid}>
              {project ? 'Save' : 'Add project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
