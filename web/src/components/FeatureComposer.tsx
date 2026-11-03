import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { Priority } from '@shared/types.ts';
import { api } from '@/api';
import { upsertFeature } from '@/store';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Composer, composerTextareaClass } from './ui/composer';
import { MentionTextarea } from './MentionTextarea';
import { toastError } from './toast';

const PRIORITIES: { id: Priority; label: string; dot: string }[] = [
  { id: 'low', label: 'Low', dot: 'bg-zinc-400' },
  { id: 'medium', label: 'Normal', dot: 'bg-sky-500 dark:bg-cyan-300' },
  { id: 'high', label: 'High', dot: 'bg-amber-500' },
];

/**
 * Compact quick-add at the top of the Backlog column: a one-line title that expands on focus into priority folder tabs,
 * an `@file`-aware description and a round send arrow.
 */
export function FeatureComposer({ projectId, onMore }: { projectId: string; onMore: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      upsertFeature(await api.createFeature(projectId, { title: title.trim(), description, priority }));
      setTitle('');
      setDescription('');
      setExpanded(false);
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
    if (e.key === 'Escape' && !title && !description) setExpanded(false);
  };

  const tabs = expanded && (
    <div className="flex gap-1 pl-3" role="radiogroup" aria-label="Priority">
      {PRIORITIES.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={priority === p.id}
          onClick={() => setPriority(p.id)}
          className={cn(
            '-mb-px inline-flex h-6 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 text-[11px] font-medium transition-colors',
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
  );

  return (
    <Composer
      size="sm"
      tabs={tabs}
      showFooter={expanded}
      onSend={submit}
      canSend={!!title.trim()}
      sending={saving}
      sendLabel="Add to backlog"
      footerLeft={
        <Button type="button" variant="ghost" size="pill" onClick={onMore} title="Open the full feature form (dependencies…)">
          <SlidersHorizontal /> More options
        </Button>
      }
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={() => setExpanded(true)}
        onKeyDown={onKeyDown}
        placeholder="Quick add a feature…"
        aria-label="Feature title"
        className="w-full bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/80"
      />
      {expanded && (
        <MentionTextarea
          projectId={projectId}
          value={description}
          onChange={setDescription}
          onKeyDown={onKeyDown}
          placeholder="Details, acceptance criteria, @files… (optional)"
          rows={2}
          className={composerTextareaClass}
        />
      )}
    </Composer>
  );
}
