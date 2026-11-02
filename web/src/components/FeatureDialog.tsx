import { useEffect, useState } from 'react';
import type { Feature, Priority } from '@shared/types.ts';
import { api } from '@/api';
import { upsertFeature } from '@/store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, Input, Select, Textarea } from './ui/input';
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(feature?.title ?? '');
      setDescription(feature?.description ?? '');
      setPriority(feature?.priority ?? 'medium');
    }
  }, [open, feature]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const f = feature
        ? await api.updateFeature(feature.id, { title, description, priority })
        : await api.createFeature(projectId, { title, description, priority });
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
          <Field label="Description & implementation requirements" hint="Multiline. Be specific: acceptance criteria, edge cases, files or patterns to follow.">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
