import { useState } from 'react';
import { ArrowUp, Bug, FileText, FlaskConical, SlidersHorizontal, Sparkles, Wrench } from 'lucide-react';
import type { Priority } from '@shared/types.ts';
import { api } from '@/api';
import { upsertFeature } from '@/store';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
import { MentionTextarea } from './MentionTextarea';
import { toastError } from './toast';

const PRIORITIES: { id: Priority; label: string; dot: string }[] = [
  { id: 'low', label: 'Low', dot: 'bg-zinc-400' },
  { id: 'medium', label: 'Normal', dot: 'bg-sky-500 dark:bg-cyan-300' },
  { id: 'high', label: 'High', dot: 'bg-amber-500' },
];

const SUGGESTIONS = [
  { icon: <FlaskConical />, text: 'Add tests for ' },
  { icon: <Bug />, text: 'Fix bug: ' },
  { icon: <Wrench />, text: 'Refactor ' },
  { icon: <FileText />, text: 'Update docs for ' },
];

/**
 * Emergent-style composer for quick-adding a backlog feature: priority folder tabs, a metal card with a title and an
 * `@file`-aware description, and a round send arrow. `hero` renders the big empty-board version with suggestion chips.
 */
export function FeatureComposer({ projectId, hero, onMore }: { projectId: string; hero?: boolean; onMore: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [expanded, setExpanded] = useState(!!hero);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      upsertFeature(await api.createFeature(projectId, { title: title.trim(), description, priority }));
      setTitle('');
      setDescription('');
      if (!hero) setExpanded(false);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && !hero && !title && !description) setExpanded(false);
  };

  return (
    <div className={cn(hero && 'w-full max-w-2xl')}>
      {expanded && (
        <div className="flex gap-1 pl-3" role="radiogroup" aria-label="Priority">
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={priority === p.id}
              onClick={() => setPriority(p.id)}
              className={cn(
                '-mb-px inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 font-medium transition-colors',
                hero ? 'h-8 text-xs' : 'h-6 text-[11px]',
                priority === p.id
                  ? 'relative z-10 border-metal-edge bg-gradient-to-b from-[hsl(var(--metal-raised-hi))] to-[hsl(var(--metal-hi))] text-foreground shadow-[inset_0_1px_0_hsl(var(--metal-highlight))]'
                  : 'border-transparent bg-foreground/[0.04] text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', p.dot)} />
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className={cn('metal-surface rounded-2xl transition-shadow focus-within:shadow-glow', hero ? 'p-4' : 'p-2.5')}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={onKeyDown}
          placeholder={hero ? 'Describe a feature for the agents to build…' : 'Quick add a feature…'}
          aria-label="Feature title"
          className={cn('w-full bg-transparent font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/80', hero ? 'text-base' : 'text-sm')}
        />
        {expanded && (
          <>
            <MentionTextarea
              projectId={projectId}
              value={description}
              onChange={setDescription}
              onKeyDown={onKeyDown}
              placeholder="Details, acceptance criteria, @files… (optional)"
              rows={hero ? 3 : 2}
              className="mt-2 min-h-0 resize-none border-0 bg-transparent bg-none px-0 shadow-none focus-visible:ring-0"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="pill" onClick={onMore} title="Open the full feature form (dependencies…)">
                <SlidersHorizontal /> More options
              </Button>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] text-muted-foreground sm:inline">⌘/Ctrl + Enter</span>
                <Button type="button" size="icon-round" onClick={submit} disabled={!title.trim() || saving} aria-label="Add to backlog" title="Add to backlog">
                  <ArrowUp />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
      {hero && (
        <div className="mt-5 flex flex-col items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Not sure where to start? Try these
          </span>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <Chip key={s.text} icon={s.icon} onClick={() => setTitle(s.text)}>
                {s.text.trim().replace(/:$/, '')}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
