import { useEffect, useMemo, useState } from 'react';
import { Bot, FolderGit2, Plus, Settings, SlidersHorizontal, Trash2, Wifi, WifiOff } from 'lucide-react';
import type { Feature, Project } from '@shared/types.ts';
import { api } from './api';
import { getState, loadFeatures, onNotification, useStore } from './store';
import { needsAttention } from './components/status';
import { cn, formatCost } from './lib/utils';
import { Button } from './components/ui/button';
import { Board } from './components/Board';
import { FeatureDialog } from './components/FeatureDialog';
import { ProjectDialog } from './components/ProjectDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { AgentDetailSheet } from './components/AgentDetailSheet';
import { ConfirmHost, confirm } from './components/confirm';
import { Toaster, toast, toastError } from './components/toast';

const LAST_PROJECT_KEY = 'orch:lastProject';

function readLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const projects = useStore((s) => s.projects);
  const connected = useStore((s) => s.connected);
  const features = useStore((s) => s.features);
  const [projectId, setProjectId] = useState<string | null>(readLastProject());
  const [projectDialog, setProjectDialog] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [featureDialog, setFeatureDialog] = useState<{ open: boolean; feature: Feature | null }>({ open: false, feature: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId) ?? null;

  // Notifications: a desktop notification when the tab is in the background, a toast otherwise.
  useEffect(
    () =>
      onNotification((n) => {
        const open = () => {
          const f = n.featureId ? getState().features[n.featureId] : null;
          if (f) {
            setProjectId(f.projectId);
            setDetailId(f.id);
          }
        };
        const hidden = document.visibilityState === 'hidden' || !document.hasFocus();
        if (hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const dn = new Notification(n.title, { body: n.body, tag: n.id });
          dn.onclick = () => {
            window.focus();
            open();
            dn.close();
          };
        } else {
          toast(`${n.title} — ${n.body}`, n.level === 'error' ? 'error' : 'info');
        }
      }),
    [],
  );

  useEffect(() => {
    if (projects.length && !project) setProjectId(projects[0].id);
  }, [projects, project]);

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(LAST_PROJECT_KEY, projectId);
    } catch {
      /* ignore */
    }
    loadFeatures(projectId).catch(toastError);
  }, [projectId]);

  const counts = useMemo(() => {
    const c: Record<string, { active: number; total: number; attention: number }> = {};
    for (const f of Object.values(features)) {
      c[f.projectId] ??= { active: 0, total: 0, attention: 0 };
      c[f.projectId].total++;
      if (needsAttention(f)) c[f.projectId].attention++;
      if (f.agentStatus === 'running' || f.agentStatus === 'initialising' || f.agentStatus === 'queued') c[f.projectId].active++;
    }
    return c;
  }, [features]);

  const projectCost = useMemo(
    () =>
      Object.values(features)
        .filter((f) => f.projectId === projectId)
        .reduce((sum, f) => sum + (f.totals?.costUsd ?? f.run?.estimatedCostUsd ?? 0), 0),
    [features, projectId],
  );

  const removeProject = async (p: Project) => {
    const ok = await confirm({
      title: `Remove "${p.name}" from the dashboard?`,
      description: 'Its board and execution history are removed from the orchestrator. The repository, branches and worktrees on disk are NOT deleted.',
      confirmLabel: 'Remove project',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteProject(p.id);
      toast('Project removed (files untouched)');
      if (projectId === p.id) setProjectId(null);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">AI Orchestrator</div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {connected ? <Wifi className="h-3 w-3 text-emerald-500" /> : <WifiOff className="h-3 w-3 text-red-500" />}
              {connected ? 'local backend connected' : 'reconnecting…'}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 pb-1 pt-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Projects</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setProjectDialog({ open: true, project: null })} title="Add project">
            <Plus />
          </Button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => setProjectId(p.id)}
              className={cn(
                'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                p.id === projectId ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              <FolderGit2 className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {counts[p.id]?.attention ? (
                <span
                  className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-medium text-amber-800 dark:text-amber-300"
                  title={`${counts[p.id].attention} feature(s) waiting for you`}
                >
                  {counts[p.id].attention} waiting
                </span>
              ) : null}
              {counts[p.id]?.active ? (
                <span className="rounded-full bg-sky-500/15 px-1.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">{counts[p.id].active}</span>
              ) : null}
              <button
                className="hidden text-muted-foreground hover:text-red-600 group-hover:block"
                onClick={(e) => {
                  e.stopPropagation();
                  removeProject(p);
                }}
                title="Remove from dashboard"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {projects.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">No projects yet.</p>}
        </nav>
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setSettingsOpen(true)}>
            <Settings /> Settings
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {project ? (
          <>
            <header className="flex items-center justify-between gap-4 border-b px-5 py-3">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">{project.name}</h1>
                <p className="truncate font-mono text-[11px] text-muted-foreground" title={project.path}>
                  {project.path} · base {project.baseBranch}
                  {project.description && <span className="font-sans"> · {project.description}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {projectCost > 0 && <span className="text-xs text-muted-foreground" title="Sum of all agent runs in this project; estimate only">est. ~{formatCost(projectCost)}</span>}
                <Button variant="outline" size="sm" onClick={() => setProjectDialog({ open: true, project })}>
                  <SlidersHorizontal /> Project settings
                </Button>
                <Button size="sm" onClick={() => setFeatureDialog({ open: true, feature: null })}>
                  <Plus /> New feature
                </Button>
              </div>
            </header>
            <div className="min-h-0 flex-1">
              <Board projectId={project.id} onOpen={(f) => setDetailId(f.id)} onAdd={() => setFeatureDialog({ open: true, feature: null })} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <FolderGit2 className="h-10 w-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Register your first project</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Point the orchestrator at an existing local Git repository. Each feature you move into Build gets its own branch, worktree and Claude Code agent.
            </p>
            <Button onClick={() => setProjectDialog({ open: true, project: null })}>
              <Plus /> Add project
            </Button>
          </div>
        )}
      </main>

      <ProjectDialog
        open={projectDialog.open}
        project={projectDialog.project}
        onOpenChange={(open) => setProjectDialog((s) => ({ ...s, open }))}
        onSaved={(p) => setProjectId(p.id)}
      />
      {project && (
        <FeatureDialog
          open={featureDialog.open}
          feature={featureDialog.feature}
          projectId={project.id}
          onOpenChange={(open) => setFeatureDialog((s) => ({ ...s, open }))}
        />
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AgentDetailSheet featureId={detailId} onClose={() => setDetailId(null)} onEdit={(f) => setFeatureDialog({ open: true, feature: f })} />
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
