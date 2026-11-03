import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, Loader2 } from 'lucide-react';
import type { Project } from '@shared/types.ts';
import { api } from '../api';
import { upsertProject } from '../store';
import { cn } from '../lib/utils';
import { Input } from './ui/input';
import { toast, toastError } from './toast';

/**
 * Header control that changes the project's base branch (the ref new feature
 * branches start from). It never checks anything out in the main repo.
 */
export function BranchSwitcher({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [checkedOut, setCheckedOut] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Reload the branch list every time the popover opens (branches change outside the app).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setQuery('');
    api
      .validatePath(project.path)
      .then((v) => {
        if (cancelled) return;
        setBranches(v.branches);
        setCheckedOut(v.currentBranch);
        if (v.error) toast(v.error, 'error');
      })
      .catch((err) => !cancelled && toastError(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, project.path]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = branches ?? [];
    return q ? list.filter((b) => b.toLowerCase().includes(q)) : list;
  }, [branches, query]);

  const choose = async (branch: string) => {
    if (branch === project.baseBranch) {
      setOpen(false);
      return;
    }
    setSaving(branch);
    try {
      const updated = await api.updateProject(project.id, { baseBranch: branch });
      upsertProject(updated);
      toast(`New features will branch from ${branch}`);
      setOpen(false);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'metal-raised inline-flex h-7 max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full px-2.5 font-mono text-[11px] text-muted-foreground transition-[filter,box-shadow,color] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          open && 'text-foreground shadow-glow',
        )}
        title="Base branch: new feature branches start here. Click to change."
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <GitBranch className="h-3 w-3 shrink-0 text-primary" />
        <span className="truncate">{project.baseBranch}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <div className="metal-surface absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl p-2 text-foreground">
          <div className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Base branch</div>
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter branches…" className="metal-inset h-8 text-xs" />
          <div className="mt-2 max-h-64 overflow-y-auto" role="listbox">
            {loading && !branches ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading branches…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">No matching branches.</div>
            ) : (
              filtered.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="option"
                  aria-selected={b === project.baseBranch}
                  disabled={saving !== null}
                  onClick={() => choose(b)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06] disabled:opacity-60',
                    b === project.baseBranch && 'metal-raised',
                  )}
                >
                  {saving === b ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Check className={cn('h-3.5 w-3.5 shrink-0 text-primary', b === project.baseBranch ? 'opacity-100' : 'opacity-0')} />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono">{b}</span>
                  {b === checkedOut && <span className="shrink-0 text-[10px] text-muted-foreground">checked out</span>}
                </button>
              ))
            )}
          </div>
          <p className="mt-2 border-t px-1 pt-2 text-[10px] leading-snug text-muted-foreground">
            New features branch from this. Existing features keep the ref they started from. Your repo's checkout is not changed.
          </p>
        </div>
      )}
    </div>
  );
}
