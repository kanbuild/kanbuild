import { useEffect, useState } from 'react';
import { api } from '@/api';
import { setSettings, useStore } from '@/store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, Input } from './ui/input';
import { toastError } from './toast';

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useStore((s) => s.settings);
  const [concurrency, setConcurrency] = useState(2);
  const [defaultModel, setDefaultModel] = useState('');
  const [editorCommand, setEditorCommand] = useState('code');
  const [claudeBinary, setClaudeBinary] = useState('claude');

  useEffect(() => {
    if (open && settings) {
      setConcurrency(settings.concurrency);
      setDefaultModel(settings.defaultModel);
      setEditorCommand(settings.editorCommand);
      setClaudeBinary(settings.claudeBinary);
    }
  }, [open, settings]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSettings(await api.updateSettings({ concurrency, defaultModel, editorCommand, claudeBinary }));
      onOpenChange(false);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Applies to all projects.</DialogDescription>
          </DialogHeader>
          <Field label="Max concurrent agents" hint="Additional features moved into Build wait in a queue.">
            <Input type="number" min={1} max={16} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-24" />
          </Field>
          <Field label="Default model" hint="Used when a project has no model override. Empty = Claude Code default.">
            <Input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="default" className="font-mono text-xs" />
          </Field>
          <Field label="Editor command" hint="Used by “Open in editor”, e.g. code, cursor, zed, idea.">
            <Input value={editorCommand} onChange={(e) => setEditorCommand(e.target.value)} className="font-mono text-xs" />
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
