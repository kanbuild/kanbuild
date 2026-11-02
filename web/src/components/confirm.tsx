import { useState } from 'react';
import { create } from './confirmStore';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

export interface ConfirmOptions {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

/** Promise-based confirmation dialog: `if (await confirm({...})) ...` */
export const confirm = (opts: ConfirmOptions) => create(opts);

export function ConfirmHost() {
  const [, force] = useState(0);
  const pending = create.useCurrent(() => force((n) => n + 1));
  if (!pending) return null;
  const { opts, resolve } = pending;
  return (
    <Dialog open onOpenChange={(o) => !o && resolve(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{opts.title}</DialogTitle>
          <DialogDescription asChild>
            <div>{opts.description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => resolve(false)}>
            Cancel
          </Button>
          <Button variant={opts.destructive ? 'destructive' : 'default'} onClick={() => resolve(true)} autoFocus>
            {opts.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
