import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Toast = { id: number; text: string; tone: 'info' | 'error' };
let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();

export function toast(text: string, tone: Toast['tone'] = 'info') {
  const t = { id: nextId++, text, tone };
  toasts = [...toasts, t];
  subs.forEach((s) => s());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    subs.forEach((s) => s());
  }, tone === 'error' ? 7000 : 3500);
}

export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : String(err), 'error');
}

export function Toaster() {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((n) => n + 1);
    subs.add(s);
    return () => {
      subs.delete(s);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto max-w-sm rounded-md border px-4 py-2.5 text-sm shadow-lg animate-in slide-in-from-bottom-2',
            t.tone === 'error' ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200' : 'bg-background',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
