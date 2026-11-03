import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { CLAUDE_ROLES, type ClaudeRole, type PathValidation, type PipelineConfig, type Project, type RolesConfig } from '@shared/types.ts';
import { api, type LaunchPreview } from '@/api';
import { PROFILE_HELP } from './SettingsDialog';
import { upsertProject, useStore } from '@/store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, Input, Select, Textarea } from './ui/input';
import { toastError } from './toast';
import { CapabilitiesPicker } from './CapabilitiesPicker';

const NO_TOOLS: string[] = [];

export const DEFAULT_PIPELINE: PipelineConfig = {
  plan: true,
  planApproval: true,
  validate: true,
  validationCommands: [],
  tester: true,
  reviewer: false,
  finalApproval: false,
  maxFixLoops: 2,
  autoCreatePr: false,
  prDraft: true,
  remote: 'origin',
};

const ROLE_HELP: Record<ClaudeRole, string> = {
  planner: 'Read-only. Writes the implementation plan.',
  developer: 'Implements the feature and fixes validation failures and review findings (same session as the planner).',
  tester: 'Fresh session. Adds and runs tests for the feature.',
  reviewer: 'Fresh, read-only session. Reviews the diff and requests changes.',
};

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${disabled ? 'opacity-50' : 'hover:bg-muted/40'}`}>
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

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
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const globalProfile = useStore((s) => s.settings?.agentProfile ?? 'lean');
  const [pipeline, setPipeline] = useState<PipelineConfig>(DEFAULT_PIPELINE);
  const [validationText, setValidationText] = useState('');
  const [detected, setDetected] = useState<{ commands: string[]; source: string } | null>(null);
  const [roles, setRoles] = useState<RolesConfig>({});
  const [previewRole, setPreviewRole] = useState<ClaudeRole>('developer');
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
    setMcpServers(project?.mcpServers ?? []);
    setSkills(project?.skills ?? []);
    setPipeline(project?.pipeline ?? DEFAULT_PIPELINE);
    setValidationText((project?.pipeline.validationCommands ?? []).join('\n'));
    setRoles(project?.roles ?? {});
    setDetected(null);
    setPreview(null);
    setShowPrompt(false);
    if (project) api.launchPreview(project.id).then(setPreview).catch(() => {});
    if (project) api.validationPreview(project.id).then(setDetected).catch(() => {});
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
      mcpServers,
      skills,
      allowedTools: tools.split('\n').map((t) => t.trim()).filter(Boolean),
      pipeline: { ...pipeline, validationCommands: validationText.split('\n').map((t) => t.trim()).filter(Boolean) },
      roles,
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
  const setP = (patch: Partial<PipelineConfig>) => setPipeline((p) => ({ ...p, ...patch }));
  const setRole = (role: ClaudeRole, patch: Partial<{ model: string; effort: string }>) =>
    setRoles((r) => ({ ...r, [role]: { model: r[role]?.model ?? '', effort: r[role]?.effort ?? '', ...patch } as RolesConfig[ClaudeRole] }));
  const shownPreview = preview?.roles?.[previewRole] ?? preview;

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
          <CapabilitiesPicker
            repoPath={project?.path ?? path}
            enabled={!!valid}
            profile={(agentProfile || globalProfile) as 'lean' | 'full'}
            mcpServers={mcpServers}
            skills={skills}
            onChange={(next) => {
              if (next.mcpServers) setMcpServers(next.mcpServers);
              if (next.skills) setSkills(next.skills);
            }}
          />
          <details className="rounded-lg border p-3" open={!!mcpConfig}>
            <summary className="cursor-pointer text-sm font-semibold">Advanced: extra MCP config</summary>
            <div className="pt-3">
              <Field label="MCP config (optional)" hint="JSON or a file path passed as an additional `claude --mcp-config`, on top of the servers selected above.">
                <Input value={mcpConfig} onChange={(e) => setMcpConfig(e.target.value)} placeholder=".mcp.json" className="font-mono text-xs" />
              </Field>
            </div>
          </details>
          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-semibold">Pipeline</legend>
            <p className="text-[11px] text-muted-foreground">What happens after a card enters Build. Every step runs in the feature&apos;s worktree; branches are never merged.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Toggle checked={pipeline.plan} onChange={(v) => setP({ plan: v })} label="1. Plan first" hint="A read-only planner writes an implementation plan." />
              <Toggle checked={pipeline.planApproval} disabled={!pipeline.plan} onChange={(v) => setP({ planApproval: v })} label="Approve the plan" hint="Pause until you approve or comment on the plan." />
              <Toggle checked={pipeline.validate} onChange={(v) => setP({ validate: v })} label="2. Validate" hint="Kanbuild runs the commands below after each code change; failures go back to the developer." />
              <Toggle checked={pipeline.tester} onChange={(v) => setP({ tester: v })} label="3. Tester agent" hint="A separate agent adds and runs tests." />
              <Toggle checked={pipeline.reviewer} onChange={(v) => setP({ reviewer: v })} label="4. Reviewer agent" hint="A read-only agent reviews the diff; requested changes go back to the developer." />
              <Toggle checked={pipeline.finalApproval} onChange={(v) => setP({ finalApproval: v })} label="5. Final approval" hint="Pause before Done so you can review the diff." />
            </div>
            {pipeline.validate && (
              <Field
                label="Validation commands (one per line)"
                hint={
                  detected
                    ? detected.commands.length
                      ? `Empty = auto-detect: ${detected.commands.join(' · ')} (from ${detected.source}; dependencies are installed first if node_modules is missing).`
                      : 'Empty = auto-detect (nothing detected in this repository; validation is skipped).'
                    : 'Empty = auto-detect from package.json, Cargo.toml or go.mod.'
                }
              >
                <Textarea value={validationText} onChange={(e) => setValidationText(e.target.value)} rows={3} className="font-mono text-xs" placeholder={detected?.commands.join('\n') || 'npm test'} />
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Max automatic fix rounds" hint="Per reason (validation, review).">
                <Input type="number" min={0} max={5} value={pipeline.maxFixLoops} onChange={(e) => setP({ maxFixLoops: Number(e.target.value) })} />
              </Field>
              <Field label="Git remote" hint="For pull requests.">
                <Input value={pipeline.remote} onChange={(e) => setP({ remote: e.target.value })} className="font-mono text-xs" />
              </Field>
              <div className="space-y-2 pt-5">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={pipeline.prDraft} onChange={(e) => setP({ prDraft: e.target.checked })} /> Draft pull requests
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={pipeline.autoCreatePr} onChange={(e) => setP({ autoCreatePr: e.target.checked })} /> Open a PR automatically when Done
                </label>
              </div>
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-semibold">Agent roles</legend>
            <p className="text-[11px] text-muted-foreground">Optional model and effort per role (empty = the project/global setting). A cheaper model often works well for review.</p>
            {CLAUDE_ROLES.map((role) => (
              <div key={role} className="grid grid-cols-[6rem_1fr_8rem] items-center gap-2">
                <span className="text-sm font-medium capitalize" title={ROLE_HELP[role]}>
                  {role}
                </span>
                <Input value={roles[role]?.model ?? ''} onChange={(e) => setRole(role, { model: e.target.value })} placeholder={model || 'model: inherit'} className="h-8 font-mono text-xs" />
                <Select value={roles[role]?.effort ?? ''} onChange={(e) => setRole(role, { effort: e.target.value })} className="h-8 text-xs">
                  <option value="">effort: inherit</option>
                  {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </fieldset>
          <Field
            label="Allowed tools (one per line)"
            hint="Passed to `claude --allowedTools`. Agents run with --permission-mode acceptEdits; anything not listed is denied (no unrestricted permissions)."
          >
            <Textarea value={tools} onChange={(e) => setTools(e.target.value)} rows={8} className="font-mono text-xs" />
          </Field>
          {shownPreview && (
            <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                How agents are launched (saved settings)
                {preview?.roles && (
                  <select className="ml-auto h-6 rounded border bg-background px-1 text-[11px]" value={previewRole} onChange={(e) => setPreviewRole(e.target.value as ClaudeRole)}>
                    {CLAUDE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{shownPreview.command}</pre>
              <button type="button" className="text-[11px] text-sky-600 hover:underline" onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? 'Hide' : 'Show'} the {previewRole} prompt template
              </button>
              {showPrompt && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px]">{shownPreview.prompt}</pre>}
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
