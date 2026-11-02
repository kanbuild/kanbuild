import { useEffect } from 'react';
import type { ConfirmOptions } from './confirm';

interface Pending {
  opts: ConfirmOptions;
  resolve: (v: boolean) => void;
}
let current: Pending | null = null;
const subs = new Set<() => void>();

function notify() {
  subs.forEach((s) => s());
}

export function create(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    current = {
      opts,
      resolve: (v) => {
        current = null;
        notify();
        resolve(v);
      },
    };
    notify();
  });
}

create.useCurrent = (onChange: () => void) => {
  useEffect(() => {
    subs.add(onChange);
    return () => {
      subs.delete(onChange);
    };
  }, [onChange]);
  return current;
};
