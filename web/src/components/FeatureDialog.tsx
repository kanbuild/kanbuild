import { useEffect, useState } from 'react';
import type { Feature, Priority } from '@shared/types.ts';
import { api } from '@/api';
import { upsertFeature, useStore } from '@/store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, Input, Select } from './ui/input';
import { MentionTextarea } from './MentionTextarea';
import { toastError } from './toast';

export function FeatureDialog({
  open,
  onOpenChange,
  projectId,
  feature,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  feature?: Feature | null;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const allFeatures = useStore((s) => s.features);
  const candidates = Object.values(allFeatures)
    .filter((f) => f.projectId === projectId && f.id !== feature?.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  useEffect(() => {
    if (open) {
      setTitle(feature?.title ?? '');
      setDescription(feature?.description ?? '');
      setPriority(feature?.priority ?? 'medium');
      setDependsOn(feature?.dependsOn ?? []);
    }
  }, [open, feature]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let f = feature
        ? await api.updateFeature(feature.id, { title, description, priority })
        : await api.createFeature(projectId, { title, description, priority });
      const before = feature?.dependsOn ?? [];
      if (dependsOn.length !== before.length || dependsOn.some((d) => !before.includes(d))) f = await api.setDependencies(f.id, dependsOn);
      upsertFeature(f);
      onOpenChange(false);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{feature ? 'Edit feature' : 'New feature'}</DialogTitle>
            <DialogDescription>
              Describe what the agent should build. Project context (CLAUDE.md, docs, README) is discovered automatically from the repository.
            </DialogDescription>
          </DialogHeader>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Portfolio charts" autoFocus required />
          </Field>
          <Field label="Description & implementation requirements" hint="Multiline. Be specific: acceptance criteria, edge cases, files or patterns to follow. Type @ to reference a repository file.">
            <MentionTextarea
              projectId={projectId}
              value={description}
              onChange={setDescription}
              rows={12}
              className="font-mono text-xs"
              placeholder={'Add a line chart of portfolio value over time to the dashboard.\n\n- Use the existing chart library\n- Support 1M / 6M / 1Y ranges\n- Add unit tests for the data transformation'}
            />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="w-40">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
          {candidates.length > 0 && (
            <Field label="Depends on" hint="This feature waits until these are Done. If exactly one of them is not merged yet, its branch is used as the starting point (stacked branch).">
              <div className="metal-inset max-h-40 space-y-1 overflow-y-auto rounded-xl p-2">
                {candidates.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-foreground/[0.05]">
                    <input
                      type="checkbox"
                      checked={dependsOn.includes(c.id)}
                      onChange={(e) => setDependsOn((d) => (e.target.checked ? [...d, c.id] : d.filter((x) => x !== c.id)))}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">{c.status}</span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {feature ? 'Save' : 'Create feature'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
